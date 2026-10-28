// Research workflow orchestrator. Runs real searches through the
// provider abstraction, persists every step, and produces a cited
// brief. Steps are marked done only when their operation succeeds;
// failures are recorded with errors and retry stays possible.
const {
  getAIConfig,
} = require('../ai/ai-config.service.cjs')
const {
  MetaMuseProvider,
} = require('../ai/providers/meta-muse.provider.cjs')
const {
  searchAll,
  deduplicateSources,
  normalizeSource,
} = require('./search-providers.cjs')
const { fetchExcerpt } = require('./url-fetch.service.cjs')
const {
  createSession,
  readSession,
  writeSession,
  writeBrief,
  blankSteps,
} = require('./session-store.cjs')
const {
  validateBrief,
  buildExtractiveBrief,
  buildSynthesisPrompt,
} = require('./brief.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('research')

const MAX_QUESTIONS = 4
const MAX_QUERIES = 6
const RESULTS_PER_QUERY = 5
const MAX_SOURCES = 20
const MAX_PAGE_READS = 6

// Live runs only; persistence is the source of truth across restarts.
// cancelRequested covers the race where cancel lands before the run
// registers its controller (or after a restart cleared liveRuns).
const liveRuns = new Map()
const cancelRequested = new Set()

function activeController(id) {
  return liveRuns.get(id) || null
}

function setStep(session, id, patch) {
  const step = session.steps.find((entry) => entry.id === id)

  if (!step) {
    return
  }

  Object.assign(step, patch)
  session.updatedAt = new Date().toISOString()
}

function startStep(session, id) {
  setStep(session, id, { status: 'running', error: '', detail: '', startedAt: new Date().toISOString(), finishedAt: null })
}

function finishStep(session, id, detail = '') {
  setStep(session, id, { status: 'done', detail, finishedAt: new Date().toISOString() })
}

function failStep(session, id, error) {
  setStep(session, id, { status: 'failed', error: String(error || 'Step failed.'), finishedAt: new Date().toISOString() })
}

function skipStep(session, id, detail = '') {
  setStep(session, id, { status: 'skipped', detail, finishedAt: new Date().toISOString() })
}

function deriveQuestions(objective) {
  const base = objective.replace(/\s+/g, ' ').trim()
  const short = base.length > 140 ? `${base.slice(0, 137)}...` : base
  const questions = [
    `What is the current state of the art for: ${short}?`,
    `What are the limitations and open problems for: ${short}?`,
    `Which algorithms, architectures, or tools are used for: ${short}?`,
    `How is progress evaluated (benchmarks, metrics) for: ${short}?`,
  ]

  return questions.slice(0, MAX_QUESTIONS)
}

function deriveQueries(objective, questions) {
  const queries = [objective]

  for (const question of questions) {
    queries.push(question.replace(/^(What|Which|How)\b[^:]*:\s*/i, '').trim() || question)
  }

  const seen = new Set()
  const unique = []

  for (const query of queries) {
    const key = query.toLowerCase()

    if (!seen.has(key) && query) {
      seen.add(key)
      unique.push(query.slice(0, 300))
    }
  }

  return unique.slice(0, MAX_QUERIES)
}

function paperProviders() {
  const all = require('./search-providers.cjs').availableProviders()

  return all.filter((entry) => entry.name === 'arxiv' || entry.name === 'openalex')
}

function webProviders() {
  const all = require('./search-providers.cjs').availableProviders()

  return all.filter((entry) => entry.name !== 'arxiv' && entry.name !== 'openalex')
}

function mergeSources(session, found) {
  // Normalize at the trust boundary so only valid plain-text http(s)
  // sources ever reach the session, no matter which provider (or
  // injected search) produced them.
  const normalized = (Array.isArray(found) ? found : [])
    .map(normalizeSource)
    .filter(Boolean)
  const combined = [...session.sources, ...normalized]
  const { unique, duplicates } = deduplicateSources(combined)

  session.sources = unique.slice(0, MAX_SOURCES)

  return duplicates
}

function recordError(session, where, message) {
  session.errors.push({ where, message: String(message).slice(0, 500), at: new Date().toISOString() })
}

async function runSearchPhase(session, queries, providers, signal, searchImpl) {
  let added = 0

  for (const query of queries) {
    if (signal.aborted) {
      throw new Error('Research was cancelled.')
    }

    session.queries.push({ query, at: new Date().toISOString() })

    const result = await searchImpl(query, {
      limit: RESULTS_PER_QUERY,
      signal,
      providers,
    })

    for (const error of result.errors) {
      recordError(session, error.provider, error.message)
    }

    mergeSources(session, result.sources)
    added += result.sources.length
    await writeSession(session)
  }

  return added
}

async function runReadingPhase(session, signal, readImpl) {
  // Papers already carry abstracts; read web sources lacking them.
  const candidates = session.sources.filter((source) => !source.abstract && source.sourceType === 'web').slice(0, MAX_PAGE_READS)
  let read = 0

  for (const source of candidates) {
    if (signal.aborted) {
      throw new Error('Research was cancelled.')
    }

    const result = await readImpl(source.url, { signal })

    source.accessStatus = result.accessStatus

    if (result.ok) {
      source.excerpt = result.excerpt
      session.evidence.push({ sourceUrl: source.url, excerpt: result.excerpt.slice(0, 800), at: new Date().toISOString() })
      read += 1
    } else {
      recordError(session, 'reader', `${source.url}: ${result.detail || result.accessStatus}`)
    }

    await writeSession(session)
  }

  return { candidates: candidates.length, read }
}

function compareEvidence(session) {
  const byType = {}

  for (const source of session.sources) {
    const key = source.sourceType || 'unknown'
    byType[key] = (byType[key] || 0) + 1
  }

  session.findings = session.sources.slice(0, MAX_SOURCES).map((source, index) => {
    const text = (source.abstract || source.excerpt || '').trim()
    const claim = text
      ? `${text.slice(0, 280)}${text.length > 280 ? '...' : ''}`
      : 'No abstract or excerpt available; source was counted but not read.'

    return {
      claim,
      sourceIndexes: [index + 1],
      confidence: text ? 'medium' : 'low',
      note: text
        ? 'Single-source excerpt; corroboration required.'
        : 'Unread source; do not cite as evidence.',
    }
  })

  const kinds = Object.entries(byType).map(([kind, count]) => `${kind} x${count}`).join(', ') || 'none'

  return `Grouped ${session.sources.length} source(s): ${kinds}.`
}

async function synthesizeBrief(session, options) {
  const provider = options.llmProvider || null

  if (!provider) {
    return { markdown: buildExtractiveBrief(session), via: 'extractive (no LLM configured)' }
  }

  const prompt = buildSynthesisPrompt(session)
  const result = await provider.chat({
    model: options.model || 'muse-spark-1.3',
    messages: [
      { role: 'system', content: 'You write evidence-backed research briefs. Never invent sources or citations.' },
      { role: 'user', content: prompt },
    ],
    signal: options.signal,
  })

  const markdown = typeof result?.answer === 'string' ? result.answer : ''
  const validation = validateBrief(markdown, session.sources)

  if (!validation.ok) {
    recordError(session, 'synthesis', `LLM brief failed validation: ${validation.errors.join(' | ')}`)
    log.warn('LLM brief failed validation; using extractive fallback.')

    return { markdown: buildExtractiveBrief(session), via: 'extractive (LLM output failed citation validation)' }
  }

  return { markdown, via: `llm (${result.model || options.model || 'muse-spark-1.3'})` }
}

async function executeSession(id, options = {}) {
  const session = await readSession(id)
  const controller = new AbortController()

  liveRuns.set(id, controller)

  if (cancelRequested.has(id)) {
    controller.abort()
  }

  session.status = 'running'
  session.statusDetail = 'Research running.'
  await writeSession(session)

  const signal = controller.signal
  const searchImpl = options.searchImpl || searchAll
  const readImpl = options.readImpl || fetchExcerpt

  // Resume re-runs every phase deterministically: steps and the query
  // log restart, while already-collected sources are kept (search merge
  // deduplicates, so re-running never invents or duplicates evidence).
  session.steps = blankSteps()
  session.queries = []
  session.errors = []

  try {
    if (signal.aborted) {
      throw new Error('Research was cancelled.')
    }

    // 1. Planning.
    startStep(session, 'planning')
    await writeSession(session)
    session.questions = deriveQuestions(session.objective)
    const queries = deriveQueries(session.objective, session.questions)
    finishStep(session, 'planning', `${session.questions.length} questions, ${queries.length} queries planned.`)
    await writeSession(session)

    // 2. Web search.
    startStep(session, 'searching')
    await writeSession(session)
    const webFound = await runSearchPhase(session, queries.slice(0, 3), webProviders(), signal, searchImpl)
    finishStep(session, 'searching', `${webFound} web result(s) collected.`)
    await writeSession(session)

    // 3. Paper search.
    startStep(session, 'papers')
    await writeSession(session)
    const paperFound = await runSearchPhase(session, queries, paperProviders(), signal, searchImpl)
    finishStep(session, 'papers', `${paperFound} paper result(s) collected.`)
    await writeSession(session)

    // 4. Reading.
    startStep(session, 'reading')
    await writeSession(session)
    const reading = await runReadingPhase(session, signal, readImpl)

    if (reading.candidates === 0) {
      skipStep(session, 'reading', 'All sources already carry abstracts; no page reads needed.')
    } else {
      finishStep(session, 'reading', `Read ${reading.read} of ${reading.candidates} page(s).`)
    }

    await writeSession(session)

    // 5. Comparing.
    startStep(session, 'comparing')
    await writeSession(session)
    const comparison = compareEvidence(session)
    finishStep(session, 'comparing', comparison)
    await writeSession(session)

    // 6. Synthesizing.
    startStep(session, 'synthesizing')
    await writeSession(session)

    let llmProvider = options.llmProvider || null
    let llmError = ''

    if (!llmProvider && options.allowLlm !== false) {
      try {
        const config = getAIConfig()
        llmProvider = new MetaMuseProvider({ apiKey: config.apiKey })
      } catch (error) {
        llmError = error.message
      }
    }

    const brief = await synthesizeBrief(session, { llmProvider, signal, model: options.model })

    if (llmError && brief.via.startsWith('extractive')) {
      recordError(session, 'synthesis', llmError)
    }

    session.brief = {
      version: session.brief.version + 1,
      markdown: brief.markdown,
      generatedAt: new Date().toISOString(),
      via: brief.via,
    }
    session.decisions = [{
      text: `Brief v${session.brief.version} generated via ${brief.via}; approach selection left to user review.`,
      at: new Date().toISOString(),
    }]
    finishStep(session, 'synthesizing', `Brief v${session.brief.version} synthesized (${brief.via}).`)
    await writeSession(session)

    // 7. Brief file.
    startStep(session, 'brief')
    await writeSession(session)
    const validation = validateBrief(session.brief.markdown, session.sources)

    if (!validation.ok) {
      throw new Error(`Brief validation failed: ${validation.errors.join(' | ')}`)
    }

    await writeBrief(session.id, session.brief.markdown)
    session.implementationTasks = [
      'Reproduce the baseline from the cited sources.',
      'Implement the smallest viable approach behind a flag.',
      'Add tests with measurable acceptance criteria.',
    ]
    finishStep(session, 'brief', `Brief v${session.brief.version} saved with ${session.sources.length} source(s).`)
    session.status = session.sources.length === 0 ? 'blocked' : 'completed'
    session.statusDetail = session.sources.length === 0
      ? 'Completed with no sources: evidence is insufficient, see Limitations.'
      : `Research completed with ${session.sources.length} source(s).`
    await writeSession(session)

    return session
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research failed.'
    const cancelled = /cancelled/i.test(message)
    const fresh = await readSession(id).catch(() => session)

    for (const step of fresh.steps) {
      if (step.status === 'running') {
        failStep(fresh, step.id, message)
      }
    }

    recordError(fresh, 'run', message)
    fresh.status = cancelled ? 'cancelled' : 'failed'
    fresh.statusDetail = message
    await writeSession(fresh)

    throw error
  } finally {
    if (liveRuns.get(id) === controller) {
      liveRuns.delete(id)
    }

    cancelRequested.delete(id)
  }
}

async function startResearch(objective, options = {}) {
  const session = await createSession(objective)

  // Background run: the caller polls getStatus. Errors persist on the
  // session record; the start call itself only fails on bad input.
  executeSession(session.id, options).catch((error) => {
    log.warn(`Research ${session.id} ended: ${error.message}`)
  })

  return { id: session.id, status: session.status }
}

async function getStatus(id) {
  const session = await readSession(id)

  // A session left "running" with no live controller was interrupted
  // (restart or crash) and can be resumed.
  if (session.status === 'running' && !liveRuns.has(id)) {
    session.status = 'blocked'
    session.statusDetail = 'Interrupted (app restart or crash). Resume to continue.'
    await writeSession(session)
  }

  return session
}

async function cancelResearch(id) {
  const session = await readSession(id)

  if (session.status === 'running') {
    // Flag first, then abort: a controller registered before this
    // read is aborted below, and one registered after sees the flag
    // at startup. The flag is cleared when the run ends, so it
    // cannot leak into a later resume.
    cancelRequested.add(id)
  }

  const controller = liveRuns.get(id)

  if (controller) {
    controller.abort()
  }

  if (session.status === 'running') {
    session.status = 'cancelled'
    session.statusDetail = 'Cancelled by user. Resume to continue.'

    for (const step of session.steps) {
      if (step.status === 'running') {
        failStep(session, step.id, 'Cancelled by user.')
      }
    }

    await writeSession(session)
  }

  return session
}

async function resumeResearch(id, options = {}) {
  const session = await readSession(id)

  if (liveRuns.has(id)) {
    throw new Error('Research is already running.')
  }

  if (session.status === 'completed') {
    throw new Error('Research is already completed.')
  }

  if (session.status === 'running') {
    session.status = 'blocked'
    session.statusDetail = 'Interrupted. Resuming now.'
    await writeSession(session)
  }

  executeSession(id, options).catch((error) => {
    log.warn(`Research ${id} ended: ${error.message}`)
  })

  return { id, status: 'running' }
}

module.exports = {
  startResearch,
  getStatus,
  cancelResearch,
  resumeResearch,
  executeSession,
  deriveQuestions,
  deriveQueries,
  compareEvidence,
  synthesizeBrief,
  activeController,
}
