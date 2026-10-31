// Source quality signals for deep research. Every signal derives
// from metadata the provider actually returned (authors, venue, DOI,
// date, access status, source type). Signals are labeled observations
// with explanations — never numeric scores, and peer review is never
// claimed without evidence. Pure module: no I/O, no network.
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function yearOf(publishedAt) {
  if (typeof publishedAt !== 'string') {
    return null
  }

  const match = publishedAt.match(/(\d{4})/)

  if (!match) {
    return null
  }

  const year = Number(match[1])

  return year >= 1900 && year <= 2100 ? year : null
}

// Assesses one normalized source. Returns { signals, summary } where
// each signal is { label, detail, polarity } and polarity is
// 'positive' | 'neutral' | 'caution'. An empty-source input yields a
// single caution signal instead of throwing, so unreadable records
// stay visible rather than vanishing.
function assessSource(source) {
  const signals = []
  const record = source && typeof source === 'object' ? source : {}

  const authors = Array.isArray(record.authors)
    ? record.authors.filter((entry) => typeof entry === 'string' && entry.trim())
    : []

  if (authors.length > 0) {
    signals.push({
      label: 'Named authorship',
      detail: `${authors.length} author${authors.length === 1 ? '' : 's'} identified: ${authors.slice(0, 3).join(', ')}${authors.length > 3 ? '…' : ''}.`,
      polarity: 'positive',
    })
  } else {
    signals.push({
      label: 'No author identified',
      detail: 'The provider returned no author or organization; treat attribution as unknown.',
      polarity: 'caution',
    })
  }

  if (typeof record.venue === 'string' && record.venue.trim()) {
    signals.push({
      label: 'Publication venue known',
      detail: `Listed under ${record.venue.trim().slice(0, 120)}. Venue alone does not confirm peer review.`,
      polarity: 'neutral',
    })
  }

  if (typeof record.doi === 'string' && record.doi.trim()) {
    signals.push({
      label: 'DOI registered',
      detail: 'A DOI makes the record citable and cross-checkable across indexes.',
      polarity: 'positive',
    })
  }

  const year = yearOf(record.publishedAt)

  if (year === null) {
    signals.push({
      label: 'Publication date unknown',
      detail: 'Recency cannot be judged; confirm the date before relying on timeliness.',
      polarity: 'caution',
    })
  } else {
    const age = new Date().getFullYear() - year

    if (age > 10) {
      signals.push({
        label: `Published ${year} — may be outdated`,
        detail: `About ${age} years old. Prefer corroboration from newer sources for fast-moving topics.`,
        polarity: 'caution',
      })
    } else {
      signals.push({
        label: `Published ${year}`,
        detail: age === 0 ? 'Published this year.' : `About ${age} year${age === 1 ? '' : 's'} old.`,
        polarity: 'neutral',
      })
    }
  }

  const sourceType = typeof record.sourceType === 'string' ? record.sourceType : ''

  if (sourceType === 'preprint') {
    signals.push({
      label: 'Preprint — peer review not verified',
      detail: 'Preprints may not be peer-reviewed. Check the venue record before citing as established.',
      polarity: 'neutral',
    })
  } else if (sourceType === 'paper-open' || sourceType === 'paper') {
    signals.push({
      label: sourceType === 'paper-open' ? 'Open-access paper' : 'Indexed paper',
      detail: sourceType === 'paper-open'
        ? 'Indexed as open access; the full text may be verifiable at the source URL.'
        : 'Found via a scholarly index; peer-review status was not verified from metadata.',
      polarity: 'neutral',
    })
  } else if (sourceType === 'docs') {
    signals.push({
      label: 'Project documentation',
      detail: 'Primary source for how the project describes itself; still verify behavior locally.',
      polarity: 'positive',
    })
  }

  if (record.accessStatus === 'open') {
    signals.push({
      label: 'Open access',
      detail: 'Retrieved or reachable without a paywall, so claims can be checked directly.',
      polarity: 'positive',
    })
  } else if (record.accessStatus === 'unreadable' || record.accessStatus === 'blocked') {
    signals.push({
      label: 'Source could not be read',
      detail: 'Only the index record is available; its claims were NOT verified from full text.',
      polarity: 'caution',
    })
  }

  const host = hostOf(record.url)

  if (host) {
    signals.push({
      label: `Publisher domain: ${host}`,
      detail: 'Verify the domain matches the organization the citation claims.',
      polarity: 'neutral',
    })
  }

  const positives = signals.filter((signal) => signal.polarity === 'positive').length
  const cautions = signals.filter((signal) => signal.polarity === 'caution').length
  const summary = cautions > positives
    ? 'Thin provenance — corroborate before citing.'
    : positives > 0
      ? 'Usable provenance with noted caveats.'
      : 'Minimal provenance — verify independently.'

  return { signals, summary }
}

// Ranks sources for display only (most corroborated, most transparent
// first). Never presented as truth or factual verification.
function rankSources(sources, supportCounts) {
  const counts = supportCounts && typeof supportCounts === 'object' ? supportCounts : {}
  const listed = Array.isArray(sources) ? [...sources] : []

  const scoreOf = (source, index) => {
    const assessment = assessSource(source)
    const positives = assessment.signals.filter((signal) => signal.polarity === 'positive').length
    const cautions = assessment.signals.filter((signal) => signal.polarity === 'caution').length
    const support = Number(counts[source && source.id]) || 0

    return { score: positives - cautions + support * 2, index }
  }

  return listed
    .map((source, index) => ({ source, order: scoreOf(source, index) }))
    .sort((a, b) => b.order.score - a.order.score || a.order.index - b.order.index)
    .map((entry) => entry.source)
}

module.exports = {
  assessSource,
  rankSources,
}
