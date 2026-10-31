const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  assessSource,
  rankSources,
} = require('./credibility.cjs')

function richSource() {
  return {
    id: 'src-rich',
    provider: 'openalex',
    title: 'A Richly Described Paper',
    url: 'https://example.com/rich',
    authors: ['Ada Lovelace', 'Grace Hopper'],
    publishedAt: String(new Date().getFullYear()),
    abstract: 'Abstract.',
    venue: 'Journal of Tests',
    doi: '10.1234/rich',
    sourceType: 'paper-open',
    accessStatus: 'open',
    excerpt: '',
  }
}

describe('research source credibility', () => {
  it('derives signals from available metadata only', () => {
    const { signals, summary } = assessSource(richSource())
    const labels = signals.map((signal) => signal.label)

    assert.ok(labels.includes('Named authorship'))
    assert.ok(labels.includes('DOI registered'))
    assert.ok(labels.includes('Open access'))
    assert.ok(labels.some((label) => label.startsWith('Published')))
    assert.equal(typeof summary, 'string')
    assert.ok(summary.length > 0)

    for (const signal of signals) {
      assert.ok(['positive', 'neutral', 'caution'].includes(signal.polarity))
      assert.ok(signal.detail.length > 0)
    }
  })

  it('flags thin provenance without inventing scores', () => {
    const { signals, summary } = assessSource({
      id: 'src-thin',
      provider: 'web',
      title: 'Mystery page',
      url: 'https://example.net/mystery',
      authors: [],
      publishedAt: null,
      abstract: '',
      venue: '',
      doi: null,
      sourceType: 'web',
      accessStatus: 'unknown',
      excerpt: '',
    })
    const labels = signals.map((signal) => signal.label)

    assert.ok(labels.includes('No author identified'))
    assert.ok(labels.includes('Publication date unknown'))
    assert.match(summary, /verify|corroborate/i)

    // No numeric scores anywhere on the assessment surface.
    assert.deepEqual(Object.keys(assessSource(richSource())).sort(), ['signals', 'summary'])
  })

  it('never claims peer review for preprints', () => {
    const { signals } = assessSource({
      ...richSource(),
      id: 'src-pre',
      sourceType: 'preprint',
      venue: 'arXiv',
    })
    const preprint = signals.find((signal) => signal.label.startsWith('Preprint'))

    assert.ok(preprint)
    assert.match(preprint.detail, /not verified|may not be peer-reviewed/i)
    assert.notEqual(preprint.polarity, 'positive')
  })

  it('marks stale publications as possibly outdated', () => {
    const { signals } = assessSource({ ...richSource(), publishedAt: '1998-03-01' })
    const stale = signals.find((signal) => /outdated/.test(signal.label))

    assert.ok(stale)
    assert.equal(stale.polarity, 'caution')
  })

  it('marks unreadable sources as unverified from full text', () => {
    const { signals } = assessSource({ ...richSource(), accessStatus: 'unreadable' })
    const unread = signals.find((signal) => signal.label === 'Source could not be read')

    assert.ok(unread)
    assert.equal(unread.polarity, 'caution')
  })

  it('handles empty input with a caution instead of throwing', () => {
    const { signals } = assessSource(null)

    assert.ok(signals.length > 0)
    assert.ok(signals.some((signal) => signal.polarity === 'caution'))
  })

  it('ranks transparent sources first without calling it verification', () => {
    const thin = { ...richSource(), id: 'src-a', authors: [], doi: null, publishedAt: null }
    const rich = { ...richSource(), id: 'src-b' }
    const ranked = rankSources([thin, rich], {})

    assert.equal(ranked[0].id, 'src-b')
    assert.equal(ranked[1].id, 'src-a')

    // Support counts break ties but never rewrite the records.
    const tied = rankSources([thin, rich], { 'src-a': 10 })

    assert.equal(tied[0].id, 'src-a')
    assert.equal(ranked.length, 2)
  })
})
