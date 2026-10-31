// Deep-research depth profiles. Each profile changes real execution
// behavior (question count, query fan-out, source caps, page reads,
// sub-question concurrency, verification passes) — never just a UI
// label. Pure module: no I/O, no secrets, no network.
const DEPTHS = ['quick', 'standard', 'deep']

const PROFILES = {
  quick: {
    depth: 'quick',
    label: 'Quick Research',
    maxQuestions: 2,
    queriesPerQuestion: 2,
    resultsPerQuery: 3,
    maxSources: 8,
    maxPageReads: 3,
    // Parallel sub-question searches; bounded so one run cannot
    // fan out into a provider flood.
    concurrency: 2,
    // Claim verification + conflict analysis run only when true.
    verifyClaims: false,
    // Second search iteration from discovered terminology.
    refineQueries: false,
    maxClaimsPerSource: 2,
  },
  standard: {
    depth: 'standard',
    label: 'Standard Research',
    maxQuestions: 4,
    queriesPerQuestion: 3,
    resultsPerQuery: 5,
    maxSources: 20,
    maxPageReads: 6,
    concurrency: 3,
    verifyClaims: true,
    refineQueries: false,
    maxClaimsPerSource: 3,
  },
  deep: {
    depth: 'deep',
    label: 'Deep Research',
    maxQuestions: 6,
    queriesPerQuestion: 3,
    resultsPerQuery: 6,
    maxSources: 40,
    maxPageReads: 12,
    concurrency: 4,
    verifyClaims: true,
    refineQueries: true,
    maxClaimsPerSource: 4,
  },
}

const DEFAULT_DEPTH = 'standard'

function resolveDepth(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_DEPTH
  }

  if (typeof value !== 'string' || !PROFILES[value]) {
    throw new Error(`Invalid depth: expected one of ${DEPTHS.join(', ')}.`)
  }

  return value
}

function getProfile(depth) {
  const resolved = resolveDepth(depth)
  const profile = PROFILES[resolved]

  return { ...profile }
}

module.exports = {
  DEPTHS,
  DEFAULT_DEPTH,
  PROFILES,
  resolveDepth,
  getProfile,
}
