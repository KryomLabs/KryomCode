import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
}

export interface AiChatProps {
  workspaceRoot: string | null
  activeFile: string | null
  fileName: string
  fileContent: string
  dirty: boolean
  defaultModel: string
  contextEnabled: boolean
  onStatus: (status: string) => void
}

const MODELS = ['muse-spark-1.3', 'muse-wonder-1.0'] as const

export function AiChat(props: AiChatProps) {
  const [model, setModel] = useState(props.defaultModel)
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [includeFileContext, setIncludeFileContext] = useState(
    props.contextEnabled
  )

  useEffect(() => {
    setModel(props.defaultModel)
  }, [props.defaultModel])

  useEffect(() => {
    setIncludeFileContext(props.contextEnabled)
  }, [props.contextEnabled])

  async function buildContext(): Promise<string> {
    if (includeFileContext && props.activeFile) {
      return (
        `Active file: ${props.activeFile}\n` +
        `Unsaved changes are included if present.\n\n` +
        props.fileContent.slice(0, 18000)
      )
    }

    if (props.workspaceRoot) {
      try {
        const summary = await kryom().getWorkspaceContext({ maxChars: 4000 })

        return (
          `Workspace root: ${props.workspaceRoot}\n` +
          `Project type: ${summary.projectType}\n\n${summary.context}`
        )
      } catch {
        return `Workspace root: ${props.workspaceRoot}`
      }
    }

    return ''
  }

  async function sendMessage() {
    const userPrompt = prompt.trim()

    if (!userPrompt || loading) {
      return
    }

    setError('')
    setPrompt('')
    setLoading(true)

    const userMessage: ChatMessage = { role: 'user', content: userPrompt }

    try {
      const context = await buildContext()
      const history: KryomAIMessage[] = messages
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content }))

      const result = await kryom().askAI({
        prompt: userPrompt,
        context,
        history,
        model,
      })

      setMessages((previous) => [
        ...previous,
        userMessage,
        { role: 'assistant', content: result.answer, model: result.model },
      ])
      props.onStatus(`AI response received (${result.model})`)
    } catch (e) {
      setMessages((previous) => [...previous, userMessage])
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  function clearChat() {
    if (loading) {
      return
    }

    setMessages([])
    setError('')
    props.onStatus('AI chat cleared')
  }

  return (
    <section className="ai-panel">
      <div className="ai-heading">
        <div>
          <strong>Kryom AI</strong>
          <div className="muted">Meta Muse · answers never edit files</div>
        </div>
        <button
          onClick={clearChat}
          disabled={loading || messages.length === 0}
          title="Clear conversation"
        >
          Clear
        </button>
      </div>

      <label className="model-row">
        Model
        <select
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={loading}
          aria-label="AI model"
        >
          {MODELS.map((id) => (
            <option key={id} value={id}>
              {id === 'muse-spark-1.3' ? 'Muse Spark 1.3' : 'Muse Wonder 1.0'}
            </option>
          ))}
        </select>
      </label>

      <label className="context-toggle">
        <input
          type="checkbox"
          checked={includeFileContext}
          onChange={(event) => setIncludeFileContext(event.target.checked)}
        />
        Include active file context
      </label>

      <div className="context-file">
        {includeFileContext && props.activeFile
          ? `Context: ${props.fileName}${props.dirty ? ' (unsaved edits)' : ''}`
          : includeFileContext
            ? 'No active file. Workspace context will be used.'
            : 'File context is disabled.'}
      </div>

      <div className="ai-messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty-icon">✦</div>
            <h3>What are we building?</h3>
            <p>
              Ask for code explanations, debugging help, implementation
              ideas or tests.
            </p>
            <p className="muted">
              AI suggestions do not change files automatically.
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <article
            className={`chat-message ${message.role}`}
            key={`${index}-${message.role}`}
          >
            <div className="message-role">
              {message.role === 'user'
                ? 'YOU'
                : `KRYOM AI${message.model ? ` · ${message.model}` : ''}`}
            </div>
            <pre>{message.content}</pre>
          </article>
        ))}

        {loading && (
          <div className="ai-loading" role="status">
            <span className="loading-dot" />
            Kryom AI is thinking…
          </div>
        )}
      </div>

      {error && (
        <div className="ai-error" role="alert">
          <strong>AI request failed</strong>
          <p>{error}</p>
          <button onClick={() => setError('')} className="secondary-button">
            Dismiss
          </button>
        </div>
      )}

      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void sendMessage()
        }}
      >
        <textarea
          aria-label="Ask Kryom AI"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              void sendMessage()
            }
          }}
          placeholder="Ask Kryom AI anything about your code… (Ctrl+Enter to send)"
          rows={4}
          maxLength={12000}
          disabled={loading}
        />

        <div className="composer-footer">
          <span className="muted">{prompt.length}/12000</span>
          <button type="submit" disabled={loading || !prompt.trim()}>
            {loading ? 'Thinking…' : 'Send ↑'}
          </button>
        </div>
      </form>
    </section>
  )
}
