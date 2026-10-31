const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeSource,
  deduplicateSources,
  arxivSearch,
  openAlexSearch,
  crossrefSearch,
  semanticScholarSearch,
  duckDuckGoSearch,
  tavilySearch,
  availableProviders,
  searchAll,
  toArxivQuery,
} = require('./search-providers.cjs')
const {
  assertSafeUrl,
  isBlockedHost,
  stripMarkup,
  fetchExcerpt,
} = require('./url-fetch.service.cjs')

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: { get: () => 'application/json' },
    arrayBuffer: async () => Buffer.from(JSON.stringify(data)),
  }
}

function textResponse(text, status = 200, contentType = 'text/html') {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new Error('not json') },
    text: async () => text,
    headers: { get: () => contentType },
    arrayBuffer: async () => Buffer.from(text),
  }
}

// Deterministic DNS: fetch tests must never touch a real resolver.
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

const ARXIV_XML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<id>http://arxiv.org/abs/2401.00001v1</id>
<title>Quantum Test Paper</title>
<published>2024-01-02T00:00:00Z</published>
<summary>An abstract about quantum testing.</summary>
<author><name>Ada Lovelace</name></author>
</entry>
</feed>`

const OPENALEX_JSON = {
  results: [
    {
      id: 'https://openalex.org/W1',
      doi: 'https://doi.org/10.1234/test',
      title: 'Open Test Paper',
      publication_date: '2023-05-01',
      authorships: [{ author: { display_name: 'Grace Hopper' } }],
      abstract_inverted_index: { Open: [0], abstract: [1], here: [2] },
      primary_location: {
        landing_page_url: 'https://example.com/paper',
        source: { display_name: 'Test Conf' },
      },
      open_access: { is_oa: true },
    },
  ],
}

describe('research search providers', () => {
  it('normalizes and rejects unsafe source URLs', () => {
    assert.equal(normalizeSource({ url: 'ftp://x/y', title: 't' }), null)
    assert.equal(normalizeSource({ url: '', title: 't' }), null)

    const source = normalizeSource({
      provider: 'arxiv',
      title: '  Hello   World  ',
      url: 'https://arxiv.org/abs/1',
      authors: ['A', 42, 'B'],
      abstract: 'abs',
    })

    assert.equal(source.title, 'Hello World')
    assert.deepEqual(source.authors, ['A', 'B'])
  })

  it('strips markup from source text at ingestion', () => {
    const source = normalizeSource({
      provider: 'x',
      title: 'A <b>B</b> C',
      url: 'https://a.test/',
      abstract: 'x <script>y</script> z',
    })

    assert.equal(source.title, 'A B C')
    assert.equal(source.abstract, 'x y z')

    const math = normalizeSource({
      provider: 'x',
      title: 'a < b implies c',
      url: 'https://a.test/',
    })

    assert.equal(math.title, 'a < b implies c')
  })

  it('deduplicates by DOI and canonical URL', () => {
    const sources = [
      { url: 'https://example.com/paper?utm_source=x', doi: null, title: 'a' },
      { url: 'https://example.com/paper/', doi: null, title: 'b' },
      { url: 'https://other.test/1', doi: '10.1/ABC', title: 'c' },
      { url: 'https://else.test/2', doi: '10.1/abc', title: 'd' },
      { url: 'https://unique.test/', doi: null, title: 'e' },
    ]

    const { unique, duplicates } = deduplicateSources(sources)

    assert.equal(unique.length, 3)
    assert.equal(duplicates, 2)
    assert.equal(unique[0].title, 'a')
    assert.equal(unique[1].title, 'c')
  })

  it('parses arXiv ATOM results', async () => {
    const fetchImpl = async () => textResponse(ARXIV_XML, 200, 'application/atom+xml')
    const sources = await arxivSearch('quantum', { fetchImpl })

    assert.equal(sources.length, 1)
    assert.equal(sources[0].provider, 'arxiv')
    assert.equal(sources[0].title, 'Quantum Test Paper')
    assert.equal(sources[0].publishedAt, '2024-01-02')
    assert.deepEqual(sources[0].authors, ['Ada Lovelace'])
  })

  it('builds AND-ed arXiv queries from keywords', () => {
    assert.equal(
      toArxivQuery('Compare RRT and A star path planning for warehouse robots'),
      'all:rrt+AND+all:star+AND+all:path+AND+all:planning'
    )
    assert.equal(toArxivQuery('the a an'), 'all:the%20a%20an')
  })

  it('parses OpenAlex results and rebuilds abstracts', async () => {
    const fetchImpl = async () => jsonResponse(OPENALEX_JSON)
    const sources = await openAlexSearch('quantum', { fetchImpl })

    assert.equal(sources.length, 1)
    assert.equal(sources[0].title, 'Open Test Paper')
    assert.equal(sources[0].abstract, 'Open abstract here')
    assert.equal(sources[0].doi, '10.1234/test')
    assert.equal(sources[0].accessStatus, 'open')
  })

  it('parses DuckDuckGo topics without crashing on empty data', async () => {
    const fetchImpl = async () => jsonResponse({ RelatedTopics: [] })
    const sources = await duckDuckGoSearch('quantum', { fetchImpl })

    assert.deepEqual(sources, [])
  })

  it('searchAll collects sources and records provider failures', async () => {
    const good = { name: 'good', run: async () => [{ url: 'https://a.test/1', title: 't', provider: 'good' }] }
    const bad = { name: 'bad', run: async () => { throw new Error('boom') } }
    const result = await searchAll('q', { providers: [good, bad], fetchImpl: async () => { throw new Error('unused') } })

    assert.equal(result.sources.length, 1)
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].provider, 'bad')
  })

  it('searchAll honors cancellation', async () => {
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      searchAll('q', { signal: controller.signal, providers: [] }),
      /cancelled/
    )
  })

  it('tavilySearch requires a key and refuses redirects', async () => {
    await assert.rejects(
      tavilySearch('q', { fetchImpl: async () => { throw new Error('unused') } }),
      /not configured/
    )

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })

      return jsonResponse({ results: [] })
    }

    await tavilySearch('llama', { fetchImpl, apiKey: 'test-key' })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.tavily.com/search')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.redirect, 'error')
    assert.equal(JSON.parse(calls[0].options.body).api_key, 'test-key')
  })

  it('assigns stable ids derived from the canonical key', () => {
    const first = normalizeSource({ provider: 'x', title: 't', url: 'https://example.com/paper/', doi: '10.1/ABC' })
    const second = normalizeSource({ provider: 'y', title: 't2', url: 'https://example.com/paper?utm_source=x', doi: '10.1/abc' })

    assert.match(first.id, /^src-[0-9a-f]{12}$/)
    assert.equal(first.id, second.id)
  })

  it('parses Crossref works with authors and dates', async () => {
    const fetchImpl = async (url) => {
      assert.match(url, /^https:\/\/api\.crossref\.org\/works\?/)

      return jsonResponse({
        message: {
          items: [
            {
              DOI: '10.9999/crossref-test',
              title: ['Crossref Test Paper'],
              author: [{ given: 'Marie', family: 'Curie' }],
              published: { 'date-parts': [[2022, 7, 9]] },
              URL: 'https://doi.org/10.9999/crossref-test',
              'container-title': ['Test Journal'],
              abstract: '<jats:p>An abstract.</jats:p>',
            },
          ],
        },
      })
    }
    const sources = await crossrefSearch('radioactivity', { fetchImpl })

    assert.equal(sources.length, 1)
    assert.equal(sources[0].provider, 'crossref')
    assert.equal(sources[0].title, 'Crossref Test Paper')
    assert.deepEqual(sources[0].authors, ['Marie Curie'])
    assert.equal(sources[0].publishedAt, '2022-07-09')
    assert.equal(sources[0].doi, '10.9999/crossref-test')
    assert.equal(sources[0].abstract, 'An abstract.')
  })

  it('parses Semantic Scholar papers with open-access detection', async () => {
    const fetchImpl = async (url) => {
      assert.match(url, /^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/search\?/)

      return jsonResponse({
        data: [
          {
            title: 'Scholar Test Paper',
            authors: [{ name: 'Alan Turing' }],
            year: 2021,
            abstract: 'Computation abstract.',
            url: 'https://example.com/scholar',
            venue: 'Test Conf',
            openAccessPdf: { url: 'https://example.com/scholar.pdf' },
            externalIds: { DOI: '10.8888/scholar' },
          },
          {
            title: 'Closed Paper',
            authors: [],
            year: null,
            abstract: '',
            url: 'https://example.com/closed',
            venue: '',
            openAccessPdf: null,
            externalIds: {},
          },
        ],
      })
    }
    const sources = await semanticScholarSearch('computation', { fetchImpl })

    assert.equal(sources.length, 2)
    assert.equal(sources[0].provider, 'semanticscholar')
    assert.equal(sources[0].accessStatus, 'open')
    assert.equal(sources[0].sourceType, 'paper-open')
    assert.equal(sources[0].doi, '10.8888/scholar')
    assert.equal(sources[1].accessStatus, 'unknown')
    assert.equal(sources[1].publishedAt, null)
  })

  it('paces Semantic Scholar calls to respect the rate limit', async () => {
    const fetchImpl = async () => jsonResponse({ data: [] })
    const started = Date.now()

    await semanticScholarSearch('first', { fetchImpl })
    await semanticScholarSearch('second', { fetchImpl })

    assert.ok(Date.now() - started >= 1000, 'rapid calls must be paced apart')
  })

  it('labels providers with paper and web kinds', () => {
    const providers = availableProviders()
    const kinds = new Map(providers.map((entry) => [entry.name, entry.kind]))

    assert.equal(kinds.get('arxiv'), 'paper')
    assert.equal(kinds.get('openalex'), 'paper')
    assert.equal(kinds.get('crossref'), 'paper')
    assert.equal(kinds.get('semanticscholar'), 'paper')
    assert.equal(kinds.get('duckduckgo'), 'web')
  })
})

describe('research url fetch', () => {
  it('blocks local-network hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '169.254.169.254', '[::1]']) {
      assert.equal(isBlockedHost(host), true, host)
    }

    assert.equal(isBlockedHost('arxiv.org'), false)
    assert.equal(isBlockedHost('api.openalex.org'), false)
  })

  it('assertSafeUrl rejects bad schemes and credentials', () => {
    assert.throws(() => assertSafeUrl('file:///etc/passwd'), /http/)
    assert.throws(() => assertSafeUrl('https://user:pass@x.test/'), /credentials/)
    assert.throws(() => assertSafeUrl('https://localhost/x'), /Local-network/)
    assert.throws(() => assertSafeUrl('not a url'), /invalid/)
  })

  it('strips scripts and tags, keeps text', () => {
    const out = stripMarkup('<html><head><title>T</title><script>alert(1)</script></head><body><h1>Hi</h1><p>Body <b>text</b>.</p></body></html>')

    assert.match(out, /Hi/)
    assert.match(out, /Body text/)
    assert.doesNotMatch(out, /alert/)
    assert.doesNotMatch(out, /<script/)
  })

  it('fetchExcerpt reports paywalled and missing honestly', async () => {
    const paywalled = await fetchExcerpt('https://example.com/a', {
      fetchImpl: async () => textResponse('', 403),
      lookupImpl: publicLookup,
    })

    assert.equal(paywalled.ok, false)
    assert.equal(paywalled.accessStatus, 'paywalled')

    const missing = await fetchExcerpt('https://example.com/a', {
      fetchImpl: async () => textResponse('', 404),
      lookupImpl: publicLookup,
    })

    assert.equal(missing.accessStatus, 'missing')
  })

  it('fetchExcerpt returns bounded excerpts for readable pages', async () => {
    const result = await fetchExcerpt('https://example.com/a', {
      fetchImpl: async () => textResponse('<html><head><title>Paper</title></head><body><p>' + 'word '.repeat(3000) + '</p></body></html>'),
      lookupImpl: publicLookup,
    })

    assert.equal(result.ok, true)
    assert.equal(result.accessStatus, 'read')
    assert.ok(result.excerpt.length <= 2000)
    assert.equal(result.title, 'Paper')
  })

  it('fetchExcerpt refuses to fetch blocked hosts', async () => {
    await assert.rejects(
      fetchExcerpt('http://127.0.0.1/x', { fetchImpl: async () => textResponse('') }),
      /Local-network/
    )
  })

  it('fetchExcerpt sanitizes malicious markup in excerpts', async () => {
    const result = await fetchExcerpt('https://example.com/a', {
      fetchImpl: async () => textResponse('<img src=x onerror=alert(1)><p>Safe <iframe src="evil"></iframe>text</p>'),
      lookupImpl: publicLookup,
    })

    assert.equal(result.ok, true)
    assert.doesNotMatch(result.excerpt, /onerror/)
    assert.doesNotMatch(result.excerpt, /<iframe/)
  })
})
