// KryomCode research search providers. Main process only.
// Provider abstraction: every provider implements
//   { name, search(query, { limit, signal, fetchImpl }) -> [{source}] }
// so new sources can be added without touching the research workflow.
// Built-in providers need no API key. Optional providers (Tavily)
// activate only when their credential is configured.
const { createLogger } = require('../../utils/logger.cjs')
const { getSecret } = require('../settings/secrets.service.cjs')

const log = createLogger('research-search')

function tavilyKey() {
  try {
    return getSecret('TAVILY_API_KEY')
  } catch {
    return ''
  }
}

const DEFAULT_TIMEOUT_MS = 20000
const MAX_LIMIT = 10
const USER_AGENT = 'KryomCode-Research/0.1 (mailto:research@kryomlabs.local)'

function normalizeLimit(limit, fallback = 5) {
  const value = Number.isFinite(limit) ? Math.floor(limit) : fallback

  return Math.min(Math.max(1, value), MAX_LIMIT)
}

function cleanText(value, maxLength = 2000) {
  if (typeof value !== 'string') {
    return ''
  }

  // Source records are plain text: strip anything shaped like markup
  // at ingestion so retrieved content stays inert everywhere it is
  // stored or displayed. The leading-letter rule keeps math like
  // "a < b" intact while removing real tags.
  return value
    .replace(/<\/?[a-zA-Z][^>]{0,200}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

// Canonical key for deduplication: lowercase host + path without a
// trailing slash, tracking params stripped, DOI preferred when present.
function canonicalKey(source) {
  if (source.doi) {
    return `doi:${source.doi.toLowerCase().trim()}`
  }

  try {
    const parsed = new URL(source.url)
    const params = new URLSearchParams(parsed.search)

    for (const key of [...params.keys()]) {
      if (/^utm_|^fbclid$|^gclid$/i.test(key)) {
        params.delete(key)
      }
    }

    const path = parsed.pathname.replace(/\/+$/, '') || '/'

    return `url:${parsed.hostname.toLowerCase()}${path}${params.toString() ? `?${params.toString()}` : ''}`
  } catch {
    return `url:${String(source.url).toLowerCase().trim()}`
  }
}

function normalizeSource(raw) {
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''

  if (!url || !/^https?:\/\//i.test(url)) {
    return null
  }

  return {
    provider: cleanText(raw.provider, 60) || 'unknown',
    title: cleanText(raw.title, 500) || '(untitled)',
    url: url.slice(0, 2000),
    authors: Array.isArray(raw.authors)
      ? raw.authors.filter((entry) => typeof entry === 'string').slice(0, 8).map((entry) => cleanText(entry, 120))
      : [],
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt.slice(0, 30) : null,
    abstract: cleanText(raw.abstract, 4000),
    venue: cleanText(raw.venue, 200),
    doi: typeof raw.doi === 'string' && raw.doi.trim() ? raw.doi.trim().slice(0, 200) : null,
    sourceType: cleanText(raw.sourceType, 40) || 'web',
    accessStatus: cleanText(raw.accessStatus, 40) || 'unknown',
    excerpt: cleanText(raw.excerpt, 2000),
  }
}

// First occurrence wins; losers are counted, never silently merged into
// claims. Citations always point at the surviving source record.
function deduplicateSources(sources) {
  const seen = new Map()
  const unique = []
  let duplicates = 0

  for (const source of sources) {
    if (!source || !source.url) {
      continue
    }

    const key = canonicalKey(source)

    if (seen.has(key)) {
      duplicates += 1
      continue
    }

    seen.set(key, true)
    unique.push(source)
  }

  return { unique, duplicates }
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, headers = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let upstreamAborted = false

  const onAbort = () => {
    upstreamAborted = true
    controller.abort()
  }

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      throw new Error('Search was cancelled.')
    }

    signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: controller.signal,
    })

    return response
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(upstreamAborted ? 'Search was cancelled.' : 'Search provider timed out.')
    }

    throw error
  } finally {
    clearTimeout(timer)

    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

function parseArxivXml(xml) {
  const entries = []
  const blocks = String(xml).split(/<entry>/i).slice(1)

  for (const block of blocks) {
    const pick = (tag) => {
      const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))

      return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : ''
    }

    const id = pick('id')
    const names = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/gi)]
      .map((match) => decodeEntities(match[1]).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 8)

    if (!id) {
      continue
    }

    entries.push({
      provider: 'arxiv',
      title: pick('title'),
      url: id,
      authors: names,
      publishedAt: pick('published').slice(0, 10) || null,
      abstract: pick('summary'),
      venue: 'arXiv',
      sourceType: 'preprint',
      accessStatus: 'open',
    })
  }

  return entries
}

// arXiv treats multi-word `all:` terms loosely (near-OR), so long
// objectives return noise. AND-ing keywords keeps relevance high.
const ARXIV_STOPWORDS = new Set([
  'what', 'which', 'how', 'when', 'where', 'whom', 'whose',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for',
  'with', 'from', 'by', 'as', 'at', 'into', 'over', 'under',
  'its', 'their', 'there', 'them', 'then', 'than', 'this', 'that',
  'these', 'those', 'each', 'other', 'more', 'most', 'such', 'than',
  'can', 'could', 'should', 'would', 'used', 'use', 'using',
  'state', 'art', 'current', 'novel', 'based', 'between', 'through',
  'compare', 'comparison', 'versus', 'overview', 'study', 'studies',
  'analysis', 'review', 'explore', 'investigate', 'explain',
  'understand', 'evaluate', 'evaluation',
])

function toArxivQuery(query) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !ARXIV_STOPWORDS.has(word))
    .filter((word, index, all) => all.indexOf(word) === index)
    .slice(0, 4)

  if (words.length === 0) {
    return `all:${encodeURIComponent(String(query).slice(0, 120))}`
  }

  return words.map((word) => `all:${encodeURIComponent(word)}`).join('+AND+')
}

async function arxivSearch(query, { limit = 5, signal, fetchImpl = fetch } = {}) {
  const count = normalizeLimit(limit)
  const url = `https://export.arxiv.org/api/query?search_query=${toArxivQuery(query)}&start=0&max_results=${count}&sortBy=relevance&sortOrder=descending`
  const response = await fetchWithTimeout(fetchImpl, url, { signal })

  if (!response.ok) {
    throw new Error(`arXiv search failed (HTTP ${response.status}).`)
  }

  const xml = await response.text()

  return parseArxivXml(xml)
    .slice(0, count)
    .map(normalizeSource)
    .filter(Boolean)
}

function openAlexAbstract(invertedIndex, maxWords = 400) {
  if (!invertedIndex || typeof invertedIndex !== 'object') {
    return ''
  }

  const words = []

  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) {
      continue
    }

    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < maxWords) {
        words[position] = word
      }
    }
  }

  return words.filter(Boolean).join(' ')
}

function parseOpenAlexJson(data) {
  const results = Array.isArray(data?.results) ? data.results : []

  return results.map((work) => {
    const authorships = Array.isArray(work.authorships) ? work.authorships : []
    const authors = authorships
      .map((entry) => entry?.author?.display_name)
      .filter((name) => typeof name === 'string')
      .slice(0, 8)
    const location = work.primary_location?.source || work.best_oa_location?.source || null
    const landing = work.primary_location?.landing_page_url || work.doi || work.id || ''
    const isOpen = work.open_access?.is_oa === true

    return {
      provider: 'openalex',
      title: typeof work.title === 'string' ? work.title : '',
      url: typeof landing === 'string' ? landing : '',
      authors,
      publishedAt: typeof work.publication_date === 'string' ? work.publication_date : null,
      abstract: openAlexAbstract(work.abstract_inverted_index),
      venue: typeof location?.display_name === 'string' ? location.display_name : '',
      doi: typeof work.doi === 'string' ? work.doi.replace(/^https?:\/\/doi\.org\//i, '') : null,
      sourceType: isOpen ? 'paper-open' : 'paper',
      accessStatus: isOpen ? 'open' : 'unknown',
    }
  })
}

async function openAlexSearch(query, { limit = 5, signal, fetchImpl = fetch, mailto = '' } = {}) {
  const count = normalizeLimit(limit)
  const contact = mailto ? `&mailto=${encodeURIComponent(mailto)}` : ''
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${count}${contact}&select=id,doi,title,publication_date,authorships,abstract_inverted_index,primary_location,best_oa_location,open_access`
  const response = await fetchWithTimeout(fetchImpl, url, { signal })

  if (!response.ok) {
    throw new Error(`OpenAlex search failed (HTTP ${response.status}).`)
  }

  const data = await response.json().catch(() => ({}))

  return parseOpenAlexJson(data)
    .slice(0, count)
    .map(normalizeSource)
    .filter(Boolean)
}

function parseDuckDuckGoJson(data) {
  const out = []
  const topics = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : []

  for (const topic of topics) {
    const nested = Array.isArray(topic?.Topics) ? topic.Topics : [topic]

    for (const entry of nested) {
      if (entry && entry.FirstURL && entry.Text) {
        out.push({
          provider: 'duckduckgo',
          title: String(entry.Text).split(' - ')[0].slice(0, 300),
          url: String(entry.FirstURL),
          authors: [],
          publishedAt: null,
          abstract: String(entry.Text),
          venue: '',
          sourceType: 'web',
          accessStatus: 'unknown',
        })
      }
    }
  }

  if (data?.AbstractURL && data?.AbstractText) {
    out.unshift({
      provider: 'duckduckgo',
      title: String(data.Heading || 'Summary'),
      url: String(data.AbstractURL),
      authors: [],
      publishedAt: null,
      abstract: String(data.AbstractText),
      venue: String(data.AbstractSource || ''),
      sourceType: 'web',
      accessStatus: 'unknown',
    })
  }

  return out
}

async function duckDuckGoSearch(query, { limit = 5, signal, fetchImpl = fetch } = {}) {
  const count = normalizeLimit(limit)
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const response = await fetchWithTimeout(fetchImpl, url, {
    signal,
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Web search failed (HTTP ${response.status}).`)
  }

  const data = await response.json().catch(() => ({}))

  return parseDuckDuckGoJson(data)
    .slice(0, count)
    .map(normalizeSource)
    .filter(Boolean)
}

async function tavilySearch(query, { limit = 5, signal, fetchImpl = fetch, apiKey = '' } = {}) {
  if (!apiKey) {
    throw new Error('Tavily API key is not configured.')
  }

  const count = normalizeLimit(limit)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  const onAbort = () => controller.abort()

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      throw new Error('Search was cancelled.')
    }

    signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const response = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: count,
        search_depth: 'basic',
        include_answer: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Tavily search failed (HTTP ${response.status}).`)
    }

    const data = await response.json().catch(() => ({}))
    const results = Array.isArray(data?.results) ? data.results : []

    return results
      .map((entry) => ({
        provider: 'tavily',
        title: entry.title || '',
        url: entry.url || '',
        authors: [],
        publishedAt: typeof entry.published_date === 'string' ? entry.published_date.slice(0, 10) : null,
        abstract: entry.content || '',
        venue: '',
        sourceType: 'web',
        accessStatus: 'unknown',
      }))
      .map(normalizeSource)
      .filter(Boolean)
  } catch (error) {
    if (error && error.name === 'AbortError') {
      // Caller cancellation and local timeouts share the abort
      // signal: report which one actually fired.
      if (signal && signal.aborted) {
        throw new Error('Search was cancelled.')
      }

      throw new Error('Search provider timed out.')
    }

    throw error
  } finally {
    clearTimeout(timer)

    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

function availableProviders() {
  const providers = [
    { name: 'arxiv', needsKey: false, run: arxivSearch },
    { name: 'openalex', needsKey: false, run: openAlexSearch },
    { name: 'duckduckgo', needsKey: false, run: duckDuckGoSearch },
  ]

  if (tavilyKey()) {
    providers.push({ name: 'tavily', needsKey: true, run: tavilySearch })
  }

  return providers
}

// Runs every enabled provider for one query. Provider failures are
// collected into errors and never fabricated into results.
async function searchAll(query, { limit = 5, signal, fetchImpl = fetch, providers = null } = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('A search query is required.')
  }

  if (signal && signal.aborted) {
    throw new Error('Search was cancelled.')
  }

  const selected = providers || availableProviders()
  const results = []
  const errors = []

  for (const provider of selected) {
    if (signal && signal.aborted) {
      throw new Error('Search was cancelled.')
    }

    try {
      const found = await provider.run(query.trim(), {
        limit,
        signal,
        fetchImpl,
        apiKey: tavilyKey(),
      })

      for (const source of found) {
        results.push(source)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search provider failed.'
      errors.push({ provider: provider.name, message })
      log.warn(`Provider ${provider.name} failed: ${message}`)
    }
  }

  const { unique, duplicates } = deduplicateSources(results)

  return { sources: unique, errors, duplicates }
}

module.exports = {
  normalizeSource,
  deduplicateSources,
  canonicalKey,
  arxivSearch,
  openAlexSearch,
  duckDuckGoSearch,
  tavilySearch,
  availableProviders,
  searchAll,
  parseArxivXml,
  parseOpenAlexJson,
  parseDuckDuckGoJson,
  toArxivQuery,
}
