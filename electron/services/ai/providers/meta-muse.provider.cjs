const {
  assertImplementsProvider,
} = require('./provider.interface.cjs')

// Verified Meta Model API base. The URL is fixed by design: renderer
// input and per-request options must never select an arbitrary endpoint.
const META_BASE_URL = 'https://api.meta.ai/v1'
const CHAT_COMPLETIONS_PATH = '/chat/completions'
const TEMPERATURE = 0.2
const TIMEOUT_MS = 90000

function mapHttpError(status, data) {
  if (status === 401 || status === 403) {
    return 'Meta API authentication failed. Check MODEL_API_KEY and try again.'
  }

  if (status === 429) {
    return 'Meta API rate limit reached. Wait a moment and try again.'
  }

  const detail = data?.error?.message || data?.message

  return detail || `Meta API request failed (${status}).`
}

class MetaMuseProvider {
  constructor({ apiKey, timeoutMs = TIMEOUT_MS, fetchImpl = fetch } = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error(
        'Meta API key is not configured. Add MODEL_API_KEY to the project-root .env file, then restart KryomCode.'
      )
    }

    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
    this.fetchImpl = fetchImpl

    assertImplementsProvider(this, 'MetaMuseProvider')
  }

  async chat({ model, messages, signal } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Meta AI request is missing messages.')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let cancelled = false

    const onAbort = () => {
      cancelled = true
      controller.abort()
    }

    if (signal) {
      if (signal.aborted) {
        cancelled = true
        controller.abort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    try {
      const response = await this.fetchImpl(
        `${META_BASE_URL}${CHAT_COMPLETIONS_PATH}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: TEMPERATURE,
          }),
          signal: controller.signal,
        }
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(mapHttpError(response.status, data))
      }

      const answer = data?.choices?.[0]?.message?.content

      if (typeof answer !== 'string' || !answer.trim()) {
        throw new Error(
          'Meta API returned an empty or unsupported response.'
        )
      }

      return {
        answer,
        model,
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(
          cancelled
            ? 'Meta AI request was cancelled.'
            : 'Meta AI request timed out. Please try again.'
        )
      }

      if (error instanceof TypeError) {
        throw new Error(
          'Meta API request failed. Check your network connection and try again.'
        )
      }

      throw error instanceof Error
        ? error
        : new Error('Meta API request failed.')
    } finally {
      clearTimeout(timer)

      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }
  }
}

module.exports = {
  MetaMuseProvider,
  META_BASE_URL,
}
