const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  splitSentences,
  significantTokens,
  extractClaims,
  corroborateClaims,
  detectConflicts,
  verifySession,
} = require('./evidence.cjs')

function source(overrides = {}) {
  return {
    id: 'src-1',
    provider: 'openalex',
    title: 'Test paper',
    url: 'https://example.com/1',
    authors: ['Author'],
    publishedAt: '2024-01-01',
    abstract: '',
    venue: '',
    doi: null,
    sourceType: 'paper-open',
    accessStatus: 'open',
    excerpt: '',
    ...overrides,
  }
}

describe('research evidence extraction', () => {
  it('splits sentences and drops fragments', () => {
    const sentences = splitSentences('Short. This sentence is definitely long enough to keep as a claim candidate for testing.')

    assert.equal(sentences.length, 1)
    assert.match(sentences[0], /definitely long enough/)
  })

  it('extracts question-relevant claims with stable ids', () => {
    const sources = [
      source({
        id: 'src-a',
        abstract: 'Transformers enable parallel training of large language models. Cats are small mammals that purr softly at night.',
      }),
    ]
    const claims = extractClaims(sources, ['How do transformers train language models?'], { maxPerSource: 2 })

    assert.ok(claims.length >= 1)
    assert.equal(claims[0].id, 'clm-1')
    assert.equal(claims[0].sourceId, 'src-a')
    assert.equal(claims[0].method, 'extractive')
    assert.match(claims[0].text, /Transformers enable parallel training/)
  })

  it('skips sources without readable text', () => {
    const claims = extractClaims([source({ id: 'src-empty' })], ['anything'])

    assert.deepEqual(claims, [])
  })

  it('corroborates across independent sources only', () => {
    const claims = [
      { id: 'clm-1', text: 'Retrieval augmentation substantially improves factual accuracy of language models.', sourceId: 'src-a', questionIds: [], method: 'extractive' },
    ]
    const sources = [
      source({ id: 'src-a', provider: 'arxiv', url: 'https://arxiv.org/abs/1', abstract: 'Retrieval augmentation substantially improves factual accuracy of language models.' }),
      source({ id: 'src-b', provider: 'openalex', url: 'https://example.org/other', abstract: 'We study how retrieval augmentation improves factual accuracy in deployed language models.' }),
      source({ id: 'src-c', provider: 'crossref', url: 'https://example.net/third', abstract: 'Retrieval augmentation improves factual accuracy according to several language model benchmarks.' }),
    ]
    const verified = corroborateClaims(claims, sources)

    assert.equal(verified[0].status, 'supported')
    assert.deepEqual([...verified[0].supportingSourceIds].sort(), ['src-b', 'src-c'])
    assert.match(verified[0].explanation, /independent sources/)
  })

  it('refuses self-corroboration from the same publisher', () => {
    const claims = [
      { id: 'clm-1', text: 'Retrieval augmentation substantially improves factual accuracy of language models.', sourceId: 'src-a', questionIds: [], method: 'extractive' },
    ]
    const sources = [
      source({ id: 'src-a', provider: 'openalex', url: 'https://example.com/a', abstract: 'Retrieval augmentation substantially improves factual accuracy of language models.' }),
      source({ id: 'src-b', provider: 'openalex', url: 'https://example.com/b', abstract: 'Retrieval augmentation substantially improves factual accuracy of language models.' }),
    ]
    const verified = corroborateClaims(claims, sources)

    assert.equal(verified[0].status, 'insufficient-evidence')
    assert.deepEqual(verified[0].supportingSourceIds, [])
  })

  it('marks single-source corroboration as partial', () => {
    const claims = [
      { id: 'clm-1', text: 'Quantized inference greatly reduces serving cost for small models.', sourceId: 'src-a', questionIds: [], method: 'extractive' },
    ]
    const sources = [
      source({ id: 'src-a', provider: 'arxiv', url: 'https://arxiv.org/abs/9', abstract: 'Quantized inference greatly reduces serving cost for small models.' }),
      source({ id: 'src-b', provider: 'openalex', url: 'https://example.org/q', abstract: 'This paper shows quantized inference reduces serving cost for small models in production.' }),
      source({ id: 'src-c', provider: 'crossref', url: 'https://example.net/unrelated', abstract: 'A historical survey of maritime navigation instruments and cartography methods.' }),
    ]
    const verified = corroborateClaims(claims, sources)

    assert.equal(verified[0].status, 'partially-supported')
    assert.deepEqual(verified[0].supportingSourceIds, ['src-b'])
  })

  it('flags opposing claims on overlapping topics', () => {
    const verified = [
      { id: 'clm-1', text: 'Sparse attention significantly improves long-context reasoning accuracy in transformer models.', sourceId: 'src-a', status: 'insufficient-evidence' },
      { id: 'clm-2', text: 'Sparse attention fails to improve long-context reasoning accuracy and adds limitations in transformer models.', sourceId: 'src-b', status: 'insufficient-evidence' },
    ]
    const conflicts = detectConflicts(verified)

    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].status, 'conflicting-evidence')
    assert.deepEqual([...conflicts[0].claimIds].sort(), ['clm-1', 'clm-2'])
    assert.match(conflicts[0].description, /lexically/)
  })

  it('ignores same-source and agreeing pairs', () => {
    const sameSource = [
      { id: 'clm-1', text: 'Sparse attention significantly improves long-context reasoning accuracy in transformer models.', sourceId: 'src-a', status: 'supported' },
      { id: 'clm-2', text: 'Sparse attention fails to improve long-context reasoning accuracy and adds limitations in transformer models.', sourceId: 'src-a', status: 'supported' },
    ]

    assert.deepEqual(detectConflicts(sameSource), [])

    const agreeing = [
      { id: 'clm-1', text: 'Sparse attention significantly improves long-context reasoning accuracy in transformer models.', sourceId: 'src-a', status: 'supported' },
      { id: 'clm-2', text: 'Sparse attention effectively improves long-context reasoning accuracy for transformer models.', sourceId: 'src-b', status: 'supported' },
    ]

    assert.deepEqual(detectConflicts(agreeing), [])
  })

  it('runs the full pass and marks conflicted claims', () => {
    const sources = [
      source({ id: 'src-a', provider: 'arxiv', url: 'https://arxiv.org/abs/11', abstract: 'Sparse attention significantly improves long-context reasoning accuracy in transformer models.' }),
      source({ id: 'src-b', provider: 'openalex', url: 'https://example.org/sparse', abstract: 'Sparse attention fails to improve long-context reasoning accuracy and adds limitations in transformer models.' }),
    ]
    const { claims, conflicts } = verifySession(sources, ['Does sparse attention help?'], { maxClaimsPerSource: 1 })

    assert.equal(claims.length, 2)
    assert.equal(conflicts.length, 1)
    assert.ok(claims.every((claim) => claim.status === 'conflicting-evidence'))
    assert.ok(claims.every((claim) => typeof claim.conflictNote === 'string'))
  })
})
