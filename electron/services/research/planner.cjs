// Research question understanding and planning. Decomposes a user
// objective into sub-questions, search queries, needed evidence, and
// ambiguity notes. An LLM pass produces the plan when a chat function
// is injected; every output is strictly validated, and any failure
// falls back to a deterministic extractive planner driven by the
// objective's own keywords — never hardcoded topics. Pure module
// except the injected llmChat callback: no direct I/O or network.
const { getProfile } = require('./depth-profiles.cjs')

const PLAN_STOPWORDS = new Set([
  'what', 'which', 'how', 'when', 'where', 'whom', 'whose', 'why',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'does', 'did', 'will', 'would', 'could', 'should', 'can',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for',
  'with', 'from', 'by', 'as', 'at', 'into', 'over', 'under',
  'its', 'their', 'there', 'them', 'then', 'than', 'this', 'that',
  'these', 'those', 'each', 'other', 'more', 'most', 'such',
  'please', 'explain', 'tell', 'about', 'compare', 'versus', 'vs',
  // Generic research fillers carry no topical signal; dropping them
  // keeps keyword queries focused on the objective's real subject.
  'current', 'state', 'art', 'novel', 'based', 'approach', 'approaches',
  'build', 'building', 'built', 'include', 'includes', 'including',
  'use', 'useful', 'usage', 'key', 'role', 'impact', 'impacts',
  'recent', 'future', 'trends', 'toward', 'towards', 'within',
  'without', 'across', 'level', 'high', 'low', 'overview', 'study',
  'studies', 'analysis', 'review', 'explore', 'investigate',
  'understand', 'evaluate', 'evaluation', 'between', 'through',
])

const MAX_TEXT = 300
const MAX_TERMS = 12

function extractKeywords(objective, max = 8) {
  const words = String(objective || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !PLAN_STOPWORDS.has(word))
  const unique = [...new Set(words)]

  return unique.slice(0, Math.max(1, max))
}

// Question angles are generic research facets (state, limits, tools,
// evaluation, trade-offs, adoption) applied to the objective's own
// topic text — the planner never assumes a domain.
function angleTemplates(topic) {
  return [
    `What is the current state of the art for ${topic}?`,
    `What are the limitations, failure modes, and open problems for ${topic}?`,
    `Which algorithms, architectures, libraries, or tools are used for ${topic}?`,
    `How is progress evaluated (benchmarks, metrics, datasets) for ${topic}?`,
    `What trade-offs and comparisons matter when choosing an approach for ${topic}?`,
    `How is ${topic} adopted in practice (integration, cost, maintenance)?`,
  ]
}

function queriesFor(angleText, keywords) {
  const queries = []
  const core = keywords.slice(0, 4).join(' ')

  if (core) {
    queries.push(core)
  }

  const lowered = angleText.toLowerCase()

  if (lowered.includes('limitation') || lowered.includes('failure')) {
    queries.push(`${core} limitations problems`.trim())
  } else if (lowered.includes('evaluat') || lowered.includes('benchmark')) {
    queries.push(`${core} benchmark evaluation`.trim())
  } else if (lowered.includes('tool') || lowered.includes('librar') || lowered.includes('architect')) {
    queries.push(`${core} tools implementation`.trim())
  } else if (lowered.includes('trade-off') || lowered.includes('comparison')) {
    queries.push(`${core} comparison trade-offs`.trim())
  } else if (lowered.includes('practice') || lowered.includes('adopt')) {
    queries.push(`${core} practical guide`.trim())
  }

  const seen = new Set()
  const unique = []

  for (const query of queries) {
    const key = query.toLowerCase()

    if (query && !seen.has(key)) {
      seen.add(key)
      unique.push(query.slice(0, MAX_TEXT))
    }
  }

  return unique
}

function derivePlanExtractive(objective, profile) {
  const text = String(objective || '').replace(/\s+/g, ' ').trim()
  const short = text.length > 140 ? `${text.slice(0, 137)}…` : text
  const keywords = extractKeywords(text)
  const topic = keywords.length > 0 ? keywords.slice(0, 5).join(' ') : short
  const angles = angleTemplates(topic).slice(0, profile.maxQuestions)
  const fullObjective = text.slice(0, MAX_TEXT)
  const subQuestions = angles.map((angle, index) => {
    // Every question leads with the raw objective so provider-native
    // relevance always sees the user's own words, followed by focused
    // keyword queries. Duplicate queries are skipped at execution.
    const queries = [fullObjective]

    for (const query of queriesFor(angle, keywords)) {
      if (queries.length >= profile.queriesPerQuestion) {
        break
      }

      if (!queries.includes(query)) {
        queries.push(query)
      }
    }

    return {
      id: `q${index + 1}`,
      text: angle.slice(0, MAX_TEXT),
      queries,
      status: 'pending',
    }
  })

  const evidenceNeeds = [
    'Primary sources (official docs, papers, specifications) over commentary.',
    'Comparative data: benchmarks, evaluations, or measured trade-offs.',
    'Limitations and failure modes, not only advertised capabilities.',
  ]

  const ambiguityNotes = []

  if (text.length < 40) {
    ambiguityNotes.push('The objective is short; results may span several interpretations — narrow it if the plan looks off-target.')
  }

  if (keywords.length === 0) {
    ambiguityNotes.push('No distinctive search terms were found; the plan falls back to the full objective text.')
  }

  return {
    subQuestions,
    searchTerms: keywords.slice(0, MAX_TERMS),
    evidenceNeeds,
    ambiguityNotes,
    via: 'extractive (keyword-driven)',
  }
}

function asTextArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .slice(0, maxItems)
    .map((entry) => entry.trim().slice(0, maxLength))
}

// Strict parse of the LLM plan: wrong shapes throw so the caller can
// fall back instead of running a malformed plan.
function parsePlanJson(raw, profile) {
  let parsed = null

  try {
    parsed = JSON.parse(String(raw || ''))
  } catch {
    throw new Error('The planning response was not valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The planning response had an unexpected shape.')
  }

  const questions = Array.isArray(parsed.subQuestions) ? parsed.subQuestions : null

  if (!questions || questions.length === 0) {
    throw new Error('The planning response contained no sub-questions.')
  }

  const keywords = extractKeywords(
    questions.map((entry) => (typeof entry === 'string' ? entry : entry && entry.text)).join(' ')
  )
  const subQuestions = questions.slice(0, profile.maxQuestions).map((entry, index) => {
    const text = (typeof entry === 'string' ? entry : entry && entry.text)

    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`Sub-question ${index + 1} is empty.`)
    }

    const trimmed = text.trim().slice(0, MAX_TEXT)
    const suggested = entry && typeof entry === 'object'
      ? asTextArray(entry.queries, profile.queriesPerQuestion, MAX_TEXT)
      : []
    const generated = queriesFor(trimmed, keywords).slice(0, profile.queriesPerQuestion)
    const merged = [...suggested]

    for (const query of generated) {
      if (merged.length >= profile.queriesPerQuestion) {
        break
      }

      if (!merged.includes(query)) {
        merged.push(query)
      }
    }

    return { id: `q${index + 1}`, text: trimmed, queries: merged, status: 'pending' }
  })

  return {
    subQuestions,
    searchTerms: asTextArray(parsed.searchTerms, MAX_TERMS, 80),
    evidenceNeeds: asTextArray(parsed.evidenceNeeds, 8, 200),
    ambiguityNotes: asTextArray(parsed.ambiguityNotes, 6, 200),
    via: 'llm (validated)',
  }
}

function buildPlanningPrompt(objective, profile) {
  return [
    'Decompose the research objective below into a research plan.',
    'Reply with ONLY a JSON object, no prose and no code fences.',
    `Schema: {"subQuestions": [{"text": string, "queries": [string]}], "searchTerms": [string], "evidenceNeeds": [string], "ambiguityNotes": [string]}.`,
    `Rules: at most ${profile.maxQuestions} sub-questions; each with at most ${profile.queriesPerQuestion} search queries;`,
    'cover capabilities, limitations, approaches/tools, and evaluation; flag ambiguity instead of guessing;',
    'never invent facts, papers, or citations — this is a plan, not findings.',
    '',
    `Objective: ${String(objective).slice(0, 2000)}`,
  ].join('\n')
}

async function planResearch(objective, { depth, llmChat = null, signal = null } = {}) {
  const profile = getProfile(depth)

  if (typeof objective !== 'string' || !objective.trim()) {
    throw new Error('A research objective is required.')
  }

  if (!llmChat) {
    return { ...derivePlanExtractive(objective, profile), profile }
  }

  try {
    const answer = await llmChat({
      system: 'You decompose research objectives into JSON plans. Never invent sources or findings.',
      user: buildPlanningPrompt(objective, profile),
      signal,
    })
    const plan = parsePlanJson(answer, profile)
    const fullObjective = objective.trim().slice(0, MAX_TEXT)

    // Keep the raw objective reachable even for LLM plans.
    for (const subQuestion of plan.subQuestions) {
      if (!subQuestion.queries.includes(fullObjective)) {
        subQuestion.queries.unshift(fullObjective)
        subQuestion.queries = subQuestion.queries.slice(0, Math.max(profile.queriesPerQuestion, 1))
      }
    }

    return { ...plan, profile }
  } catch (error) {
    const fallback = derivePlanExtractive(objective, profile)

    fallback.ambiguityNotes.unshift(
      `LLM planning was unavailable (${String(error && error.message || error).slice(0, 160)}); using the keyword-driven plan.`
    )
    fallback.via = 'extractive (LLM planning failed)'

    return { ...fallback, profile }
  }
}

module.exports = {
  extractKeywords,
  derivePlanExtractive,
  parsePlanJson,
  buildPlanningPrompt,
  planResearch,
}
