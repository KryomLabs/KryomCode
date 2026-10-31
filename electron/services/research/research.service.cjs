// Research workflow orchestrator. Runs real searches through the
// provider abstraction, persists every step, and produces a cited
// brief. Steps are marked done only when their operation succeeds;
// failures are recorded with errors and retry stays possible.
const crypto = require('node:crypto')

const {
  getAIConfig,
  resolveModel,
} = require('../ai/ai-config.service.cjs')
const {
  MetaMuseProvider,
} = require('../ai/providers/meta-muse.provider.cjs')
const {
  searchAll,
  deduplicateSources,
  normalizeSource,
  canonicalKey,
} = require('./search-providers.cjs')
const { fetchExcerpt } = require('./url-fetch.service.cjs')
const { getProfile, resolveDepth } = require('./depth-profiles.cjs')
const { planResearch, extractKeywords } = require('./planner.cjs')
const { verifySession } = require('./evidence.cjs')
const { assessSource } = require('./credibility.cjs')
const {
  createSession,
  readSession,
  writeSession,
  writeBrief,
  blankSteps,
  blankPlan,
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
// cancelRequested records cancel INTENT unconditionally, so a cancel
// that lands before the run registers (the resume-startup gap) can
// never be silently lost. The flag is single-use: executeSession
// consumes it at startup, resumeResearch clears stale intent before
// starting a fresh run, and the run finally-block clears it on exit.
// A flag with no following run is inert: it only takes effect when
// a run starts, and terminal statuses are never rewritten by cancel.
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

  return all.filter((entry) => entry.kind === 'paper' || entry.name === 'arxiv' || entry.name === 'openalex')
}

function webProviders() {
  const all = require('./search-providers.cjs').availableProviders()

  return all.filter((entry) => entry.kind !== 'paper' && entry.name !== 'arxiv' && entry.name !== 'openalex')
}

function mergeSources(session, found, { supports = [], maxSources = MAX_SOURCES } = {}) {
  // Normalize at the trust boundary so only valid plain-text http(s)
  // sources ever reach the session, no matter which provider (or
  // injected search) produced them.
  const stamp = new Date().toISOString()
  const normalized = (Array.isArray(found) ? found : [])
    .map(normalizeSource)
    .filter(Boolean)
    .map((source) => ({
      ...source,
      retrievedAt: source.retrievedAt || stamp,
      supports: [...new Set([...(source.supports || []), ...supports])].slice(0, 12),
      quality: assessSource(source),
    }))

  // Merge provenance BEFORE dedup: a duplicate loser still proves its
  // question is covered by the surviving record.
  const supportByKey = new Map()

  for (const source of [...session.sources, ...normalized]) {
    const key = canonicalKey(source)
    const merged = supportByKey.get(key) || []

    for (const id of source.supports || []) {
      if (!merged.includes(id)) {
        merged.push(id)
      }
    }

    supportByKey.set(key, merged.slice(0, 12))
  }

  const combined = [...session.sources, ...normalized]
  const { unique, duplicates } = deduplicateSources(combined)

  for (const source of unique) {
    const merged = supportByKey.get(canonicalKey(source))

    if (merged && merged.length > 0) {
      source.supports = merged
    }
  }

  session.sources = unique.slice(0, maxSources)

  return duplicates
}

function recordError(session, where, message) {
  session.errors.push({ where, message: String(message).slice(0, 500), at: new Date().toISOString() })
}

async function runQuestionQueries(session, question, queries, providers, profile, signal, searchImpl) {
  let added = 0

  question.status = 'running'

  for (const query of queries) {
    if (signal.aborted) {
      throw new Error('Research was cancelled.')
    }

    session.queries.push({ query, questionId: question.id, at: new Date().toISOString() })

    const result = await searchImpl(query, {
      limit: profile.resultsPerQuery,
      signal,
      providers,
    })

    for (const error of result.errors || []) {
      recordError(session, error.provider || 'search', error.message)
    }

    mergeSources(session, result.sources, { supports: [question.id], maxSources: profile.maxSources })
    added += (result.sources || []).length
  }

  question.status = 'done'
  question.sourcesFound = added

  return added
}

// Runs one provider round across sub-questions with bounded
// concurrency. Questions in a chunk run together; persistence happens
// at chunk boundaries from the single shared session object, so
// parallel merges can never clobber each other's writes. A failing
// question is recorded and the round continues; cancellation aborts
// the whole run.
async function runSearchRound(session, questions, queriesFor, providers, profile, signal, searchImpl) {
  let added = 0
  const pending = [...questions]
  const width = Math.max(1, profile.concurrency)
  // Every question leads with the raw objective, so identical queries
  // repeat across questions: run each distinct query once per round
  // and share the merged sources. The query log records executed
  // queries only, so it stays an honest account of provider calls.
  const executed = new Set()

  while (pending.length > 0) {
    if (signal.aborted) {
      throw new Error('Research was cancelled.')
    }

    const chunk = pending.splice(0, width)
    const outcomes = await Promise.all(chunk.map(async (question) => {
      try {
        const fresh = queriesFor(question).filter((query) => {
          const key = query.toLowerCase()

          if (executed.has(key)) {
            return false
          }

          executed.add(key)

          return true
        })
        const found = await runQuestionQueries(session, question, fresh, providers, profile, signal, searchImpl)

        return { question, found, error: null }
      } catch (error) {
        return { question, found: 0, error }
      }
    }))

    for (const outcome of outcomes) {
      if (outcome.error) {
        if (signal.aborted || /cancelled/i.test(String(outcome.error && outcome.error.message))) {
          throw new Error('Research was cancelled.')
        }

        outcome.question.status = 'failed'
        outcome.question.error = String(outcome.error.message || outcome.error).slice(0, 300)
        recordError(session, 'search', `${outcome.question.id}: ${outcome.question.error}`)
      } else {
        added += outcome.found
      }
    }

    await writeSession(session)
  }

  return added
}

async function runReadingPhase(session, profile, signal, readImpl) {
  // Papers already carry abstracts; read web sources lacking them.
  const candidates = session.sources.filter((source) => !source.abstract && source.sourceType === 'web').slice(0, profile.maxPageReads)
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

function confidenceForStatus(status, hasText) {
  if (!hasText) {
    return 'low'
  }

  if (status === 'supported') {
    return 'high'
  }

  if (status === 'partially-supported') {
    return 'medium'
  }

  return 'low'
}

function compareEvidence(session) {
  const byType = {}

  for (const source of session.sources) {
    const key = source.sourceType || 'unknown'
    byType[key] = (byType[key] || 0) + 1
  }

  // Backfill ids for sources that predate stable identifiers so the
  // claim pass below links by id, never by position.
  for (const source of session.sources) {
    if (source && !source.id) {
      source.id = `src-${crypto.createHash('sha1').update(canonicalKey(source)).digest('hex').slice(0, 12)}`
    }
  }

  const indexOf = new Map(session.sources.map((source, position) => [source.id, position + 1]))
  const profile = getProfile(session.depth)
  const questions = (session.plan && session.plan.subQuestions.length > 0
    ? session.plan.subQuestions.map((entry) => entry.text)
    : session.questions)

  if (!profile.verifyClaims) {
    session.claims = []
    session.conflicts = []
    session.findings = session.sources.slice(0, profile.maxSources).map((source, index) => {
      const text = (source.abstract || source.excerpt || '').trim()

      return {
        claim: text
          ? `${text.slice(0, 280)}${text.length > 280 ? '...' : ''}`
          : 'No abstract or excerpt available; source was counted but not read.',
        sourceIndexes: [index + 1],
        confidence: text ? 'medium' : 'low',
        note: text
          ? 'Quick mode: excerpt recorded without verification; corroboration required.'
          : 'Unread source; do not cite as evidence.',
      }
    })
  } else {
    const { claims, conflicts } = verifySession(session.sources, questions, {
      maxClaimsPerSource: profile.maxClaimsPerSource,
    })

    session.claims = claims
    session.conflicts = conflicts

    const claimed = new Set(claims.map((claim) => claim.sourceId))
    const findings = claims.map((claim) => {
      const indexes = [claim.sourceId, ...(claim.supportingSourceIds || [])]
        .map((id) => indexOf.get(id))
        .filter((entry) => Number.isInteger(entry))

      return {
        claim: claim.text,
        sourceIndexes: indexes.length > 0 ? [...new Set(indexes)] : [],
        confidence: confidenceForStatus(claim.status, true),
        note: `${claim.status}: ${claim.explanation}${claim.conflictNote ? ` ${claim.conflictNote}` : ''}`,
      }
    })

    // Sources that yielded no claim stay visible — counted, never
    // cited as evidence. Text too short for a claim is still shown so
    // the record stays distinguishable from a truly unread source.
    session.sources.slice(0, profile.maxSources).forEach((source, index) => {
      if (!claimed.has(source.id)) {
        const text = (source.abstract || source.excerpt || '').trim()

        findings.push({
          claim: text
            ? `${text.slice(0, 280)}${text.length > 280 ? '...' : ''}`
            : 'No abstract or excerpt available; source was counted but not read.',
          sourceIndexes: [index + 1],
          confidence: 'low',
          note: text
            ? 'Short excerpt; no verifiable claim extracted — read the source directly.'
            : 'Unread source; do not cite as evidence.',
        })
      }
    })

    session.findings = findings
  }

  const kinds = Object.entries(byType).map(([kind, count]) => `${kind} x${count}`).join(', ') || 'none'
  const verification = profile.verifyClaims
    ? ` ${session.claims.length} claim(s) checked, ${session.conflicts.length} conflict(s) flagged.`
    : ''

  return `Grouped ${session.sources.length} source(s): ${kinds}.${verification}`
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

  // Consume any cancel intent recorded before this run registered
  // (single-use: a stale flag aborts at most one startup).
  if (cancelRequested.has(id)) {
    cancelRequested.delete(id)
    controller.abort()
  }

  session.status = 'running'
  session.statusDetail = 'Research running.'
  await writeSession(session)

  const signal = controller.signal
  const searchImpl = options.searchImpl || searchAll
  const readImpl = options.readImpl || fetchExcerpt

  // Resume re-runs every phase deterministically: steps, the plan,
  // and the query log restart, while already-collected sources are
  // kept (search merge deduplicates, so re-running never invents or
  // duplicates evidence).
  session.steps = blankSteps()
  session.queries = []
  session.errors = []
  session.claims = []
  session.conflicts = []
  session.plan = blankPlan()

  const profile = getProfile(session.depth)

  try {
    if (signal.aborted) {
      throw new Error('Research was cancelled.')
    }

    // Invalid models fail the run honestly instead of reaching the
    // provider with an unvalidated id.
    const model = resolveModel(options.model)

    // 1. Planning: LLM decomposition when a key is configured,
    // keyword-driven fallback otherwise. Any planning failure still
    // yields an honest extractive plan — never a fabricated one.
    startStep(session, 'planning')
    await writeSession(session)

    let plannerChat = null

    if (options.llmProvider) {
      const provider = options.llmProvider

      plannerChat = async ({ system, user, signal: chatSignal }) => {
        const result = await provider.chat({
          model: model || 'muse-spark-1.3',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          signal: chatSignal,
        })

        return typeof result?.answer === 'string' ? result.answer : ''
      }
    } else if (options.allowLlm !== false) {
      try {
        const config = getAIConfig()
        const provider = new MetaMuseProvider({ apiKey: config.apiKey })

        plannerChat = async ({ system, user, signal: chatSignal }) => {
          const result = await provider.chat({
            model: model || config.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            signal: chatSignal,
          })

          return typeof result?.answer === 'string' ? result.answer : ''
        }
      } catch (error) {
        recordError(session, 'planning', error.message)
      }
    }

    const plan = await planResearch(session.objective, { depth: session.depth, llmChat: plannerChat, signal })

    session.plan = {
      subQuestions: plan.subQuestions,
      searchTerms: plan.searchTerms,
      evidenceNeeds: plan.evidenceNeeds,
      ambiguityNotes: plan.ambiguityNotes,
      via: plan.via,
    }
    session.questions = plan.subQuestions.map((entry) => entry.text)
    const plannedQueries = plan.subQuestions.reduce((count, entry) => count + entry.queries.length, 0)

    finishStep(session, 'planning', `${session.questions.length} questions, ${plannedQueries} queries planned (${plan.via}).`)
    await writeSession(session)

    const questions = session.plan.subQuestions

    // 2. Web search: first query per question across web providers.
    startStep(session, 'searching')
    await writeSession(session)
    const webFound = await runSearchRound(
      session,
      questions,
      (question) => question.queries.slice(0, 1),
      webProviders(),
      profile,
      signal,
      searchImpl
    )
    finishStep(session, 'searching', `${webFound} web result(s) collected.`)
    await writeSession(session)

    // 3. Paper search: every planned query across paper providers,
    // plus one refinement pass on deep when sources are still thin.
    startStep(session, 'papers')
    await writeSession(session)
    let paperFound = await runSearchRound(
      session,
      questions,
      (question) => question.queries,
      paperProviders(),
      profile,
      signal,
      searchImpl
    )

    if (profile.refineQueries && session.sources.length < profile.maxSources && !signal.aborted) {
      const discovered = extractKeywords(session.sources.map((source) => source.title).join(' '), 3)

      if (discovered.length > 0) {
        for (const question of questions) {
          question.status = 'pending'
        }

        paperFound += await runSearchRound(
          session,
          questions,
          () => [`${session.objective.slice(0, 120)} ${discovered.join(' ')}`.slice(0, 300)],
          paperProviders(),
          profile,
          signal,
          searchImpl
        )
      }
    }

    finishStep(session, 'papers', `${paperFound} paper result(s) collected.`)
    await writeSession(session)

    // 4. Reading.
    startStep(session, 'reading')
    await writeSession(session)
    const reading = await runReadingPhase(session, profile, signal, readImpl)

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
  // Validate up front: the start call fails on bad input instead of
  // creating a session that can never run.
  resolveDepth(options.depth)
  resolveModel(options.model)

  const session = await createSession(objective, { depth: options.depth, name: options.name })

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

  // Record intent unconditionally: conditioning the flag on the
  // observed status loses cancels that land in the resume-startup
  // gap (status not yet 'running', controller not yet registered).
  // The flag is single-use (consumed at startup, cleared on resume
  // and on run exit), and the status flip below still only applies
  // to 'running' sessions, so idle and terminal sessions keep
  // truthful statuses and repeated cancels stay consistent.
  cancelRequested.add(id)

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

  // A fresh explicit run supersedes stale cancel intent left by an
  // idle cancel. Cancels arriving after this point re-add the flag,
  // which the run consumes at startup.
  cancelRequested.delete(id)

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
  mergeSources,
  runSearchRound,
}
