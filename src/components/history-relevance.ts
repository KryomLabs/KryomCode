// Relevance ranking for Agent history selection (Advanced Agent,
// Part C). Orders history candidates (project chat, research
// sessions, sibling agent sessions) against the current task text so
// the most related entries surface first. Token-overlap scoring only
// — it NEVER injects anything; the user still selects each ref
// explicitly. Pure and dependency-free, covered by check-workbench.
export interface HistoryCandidate {
  id: string
  // Searchable text: titles, objectives, excerpts. Empty text scores
  // zero but still lists (recency order preserved below matches).
  text: string
}

// Small stop set: keeps common words from dominating overlap.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he',
  'she', 'them', 'us', 'me', 'my', 'your', 'our', 'their', 'as',
  'by', 'from', 'how', 'what', 'when', 'where', 'which', 'who',
  'not', 'no', 'do', 'does', 'did', 'can', 'will', 'please',
])

function tokens(text: string): Set<string> {
  const found = new Set<string>()

  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOP_WORDS.has(raw)) {
      found.add(raw)
    }
  }

  return found
}

// Counts query tokens present in the candidate. Longer query overlap
// wins; ties keep input (recency) order via a stable sort.
export function scoreHistoryCandidate(
  query: string,
  candidate: HistoryCandidate
): number {
  const queryTokens = tokens(query)

  if (queryTokens.size === 0) {
    return 0
  }

  const candidateTokens = tokens(candidate.text)
  let score = 0

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      score += 1
    }
  }

  return score
}

export function rankHistoryCandidates<T extends HistoryCandidate>(
  query: string,
  candidates: T[]
): T[] {
  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: scoreHistoryCandidate(query, candidate),
  }))

  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  return scored.map((entry) => entry.candidate)
}
