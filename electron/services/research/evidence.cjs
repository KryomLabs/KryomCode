// Evidence extraction and claim verification for deep research.
// Everything here is extractive and lexical: claims are sentences
// lifted from retrieved abstracts/excerpts, corroboration counts
// shared significant tokens across INDEPENDENT sources, and conflicts
// are flagged only when overlapping claims carry opposing polarity
// cues. Statuses always name this method so the UI can never present
// them as model-verified facts. Pure module: no I/O, no network.
const STOPWORDS = new Set([
  'what', 'which', 'how', 'when', 'where', 'whom', 'whose', 'why',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'does', 'did', 'will', 'with', 'from', 'that', 'this',
  'these', 'those', 'such', 'than', 'then', 'them', 'they', 'their',
  'there', 'also', 'into', 'over', 'under', 'between', 'through',
  'more', 'most', 'other', 'each', 'both', 'used', 'using', 'based',
  'paper', 'study', 'result', 'results', 'method', 'approach', 'propose',
  'proposed', 'present', 'show', 'shown', 'using', 'based',
])

const NEGATIVE_CUES = [
  'not', 'no', 'never', 'fails', 'fail', 'failure', 'limitation',
  'limitations', 'however', 'although', 'contrary', 'contradicts',
  'worse', 'unable', 'lack', 'lacks', 'insufficient', 'problem',
  'drawback', 'risk', 'risks', 'weakness', 'poor', 'degrade',
]

const POSITIVE_CUES = [
  'improves', 'improvement', 'achieves', 'surpasses', 'outperforms',
  'effective', 'enables', 'solves', 'solving', 'benefit', 'benefits',
  'accurate', 'robust', 'efficient', 'faster', 'better', 'best',
  'successfully', 'significant', 'novel',
]

const MIN_CLAIM_CHARS = 40
const MAX_CLAIM_CHARS = 280
const MIN_SHARED_TOKENS = 3
const MIN_CONFLICT_TOKENS = 4

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= MIN_CLAIM_CHARS && entry.length <= 800)
}

function significantTokens(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word))

  return [...new Set(tokens)]
}

function sharedTokenCount(aTokens, bSet) {
  let shared = 0

  for (const token of aTokens) {
    if (bSet.has(token)) {
      shared += 1
    }
  }

  return shared
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// Two sources are independent when they come from different providers
// or different publisher hosts. Same-provider same-host records are
// treated as one voice so index duplicates cannot corroborate each
// other.
function isIndependent(a, b) {
  if (!a || !b || a.id === b.id) {
    return false
  }

  if (a.provider && b.provider && a.provider !== b.provider) {
    return true
  }

  const hostA = hostOf(a.url)
  const hostB = hostOf(b.url)

  return Boolean(hostA && hostB && hostA !== hostB)
}

function questionTokens(questions) {
  const sets = (Array.isArray(questions) ? questions : [])
    .map((entry) => (typeof entry === 'string' ? entry : entry && entry.text))
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => new Set(significantTokens(entry)))

  return sets
}

// Lifts the most question-relevant sentences per source. Returns
// claims with stable ids (clm-1, clm-2, …) in source order.
function extractClaims(sources, questions, { maxPerSource = 3 } = {}) {
  const listed = Array.isArray(sources) ? sources : []
  const tokenSets = questionTokens(questions)
  const claims = []
  let counter = 0

  for (const source of listed) {
    if (!source || typeof source !== 'object') {
      continue
    }

    const text = (source.abstract || source.excerpt || '').trim()

    if (!text) {
      continue
    }

    const scored = splitSentences(text).map((sentence) => {
      const tokens = significantTokens(sentence)
      let relevance = 0
      const matched = []

      tokenSets.forEach((set, index) => {
        const shared = sharedTokenCount(tokens, set)

        if (shared > 0) {
          relevance += shared
          matched.push(index)
        }
      })

      return { sentence, tokens, relevance, matched }
    })

    scored.sort((a, b) => b.relevance - a.relevance)

    // Relevance 0 sentences are kept only when nothing matched at
    // all: a leading abstract sentence still describes the source.
    const pool = scored.some((entry) => entry.relevance > 0)
      ? scored.filter((entry) => entry.relevance > 0)
      : scored.slice(0, 1)

    const limit = Math.max(1, Math.min(6, Math.floor(maxPerSource) || 1))

    for (const entry of pool.slice(0, limit)) {
      counter += 1
      const clipped = entry.sentence.length > MAX_CLAIM_CHARS
        ? `${entry.sentence.slice(0, MAX_CLAIM_CHARS - 1)}…`
        : entry.sentence

      claims.push({
        id: `clm-${counter}`,
        text: clipped,
        sourceId: source.id || null,
        questionIds: entry.matched.map((index) => `q${index + 1}`),
        method: 'extractive',
      })
    }
  }

  return claims
}

function polarityOf(text) {
  const lowered = ` ${String(text || '').toLowerCase()} `
  const hasNegative = NEGATIVE_CUES.some((cue) => lowered.includes(` ${cue} `) || lowered.includes(` ${cue}s `))
  const hasPositive = POSITIVE_CUES.some((cue) => lowered.includes(cue))

  if (hasNegative && !hasPositive) {
    return 'negative'
  }

  if (hasPositive && !hasNegative) {
    return 'positive'
  }

  return 'mixed'
}

// Counts independent corroboration per claim. The claim's own source
// text plus every other independent source text form the corpus; a
// source corroborates when it shares enough significant tokens.
function corroborateClaims(claims, sources) {
  const listed = Array.isArray(claims) ? claims : []
  const records = Array.isArray(sources) ? sources : []
  const byId = new Map(records.map((source) => [source && source.id, source]))
  const corpus = records.map((source) => ({
    source,
    tokens: new Set(significantTokens(`${source.title || ''} ${source.abstract || ''} ${source.excerpt || ''}`)),
  }))

  return listed.map((claim) => {
    const own = byId.get(claim.sourceId) || null
    const claimTokens = significantTokens(claim.text)
    const needed = Math.max(MIN_SHARED_TOKENS, Math.floor(claimTokens.length * 0.4))
    const supporting = []

    for (const entry of corpus) {
      if (!isIndependent(own, entry.source)) {
        continue
      }

      if (sharedTokenCount(claimTokens, entry.tokens) >= needed) {
        supporting.push(entry.source.id)
      }
    }

    const unique = [...new Set(supporting)].filter(Boolean)

    if (unique.length >= 2) {
      return {
        ...claim,
        status: 'supported',
        supportingSourceIds: unique,
        explanation: `Similar wording appears in ${unique.length} independent sources (shared terminology, not model judgment).`,
      }
    }

    if (unique.length === 1) {
      return {
        ...claim,
        status: 'partially-supported',
        supportingSourceIds: unique,
        explanation: 'Similar wording appears in 1 other independent source; corroboration is thin.',
      }
    }

    return {
      ...claim,
      status: 'insufficient-evidence',
      supportingSourceIds: [],
      explanation: 'No other independent source shares enough terminology to corroborate this claim.',
    }
  })
}

// Flags claim pairs that overlap topically but carry opposing
// polarity cues. Conservative by design: high overlap required, and
// the description states the lexical basis.
function detectConflicts(verifiedClaims) {
  const listed = Array.isArray(verifiedClaims) ? verifiedClaims : []
  const prepared = listed.map((claim) => ({
    claim,
    tokens: new Set(significantTokens(claim.text)),
    polarity: polarityOf(claim.text),
  }))
  const conflicts = []
  const seen = new Set()
  let counter = 0

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i]
      const b = prepared[j]

      if (a.claim.sourceId === b.claim.sourceId) {
        continue
      }

      if (a.polarity === 'mixed' || b.polarity === 'mixed' || a.polarity === b.polarity) {
        continue
      }

      const shared = [...a.tokens].filter((token) => b.tokens.has(token))

      if (shared.length < MIN_CONFLICT_TOKENS) {
        continue
      }

      const key = [a.claim.id, b.claim.id].sort().join('|')

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      counter += 1

      conflicts.push({
        id: `cfl-${counter}`,
        claimIds: [a.claim.id, b.claim.id],
        sourceIds: [a.claim.sourceId, b.claim.sourceId].filter(Boolean),
        topic: shared.slice(0, 6).join(', '),
        status: 'conflicting-evidence',
        description: `Overlapping terminology (“${shared.slice(0, 6).join('”, “')}”) with opposing cues — read both sources before trusting either claim. Flagged lexically, not model-verified.`,
      })
    }
  }

  return conflicts
}

// Full deterministic pass: extract, corroborate, then flag conflicts.
// Claims from conflicts are marked so the report can point at them.
function verifySession(sources, questions, { maxClaimsPerSource = 3 } = {}) {
  const extracted = extractClaims(sources, questions, { maxPerSource: maxClaimsPerSource })
  const verified = corroborateClaims(extracted, sources)
  const conflicts = detectConflicts(verified)
  const conflicted = new Set(conflicts.flatMap((conflict) => conflict.claimIds))
  const claims = verified.map((claim) => (conflicted.has(claim.id)
    ? { ...claim, status: 'conflicting-evidence', conflictNote: 'Overlapping claims disagree — see Conflicts.' }
    : claim))

  return { claims, conflicts }
}

module.exports = {
  STOPWORDS,
  splitSentences,
  significantTokens,
  extractClaims,
  corroborateClaims,
  detectConflicts,
  verifySession,
}
