import { useEffect, useRef, useState } from 'react'
import { kryom, errorMessage, isCancelError } from '../api/kryom'
import { AiKeyNotice } from './AiKeyNotice'
import { MarkdownLite } from './MarkdownLite'

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
  pendingPrompt?: { text: string; nonce: number } | null
  researchSessionId?: string | null
  onDetachResearch?: () => void
  onOpenConnections?: () => void
}

const MODELS = ['muse-spark-1.3', 'muse-wonder-1.0'] as const

export function AiChat(props: AiChatProps) {
  const [model, setModel] = useState(props.defaultModel)
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [restored, setRestored] = useState(false)
  const [error, setError] = useState('')
  const [includeFileContext, setIncludeFileContext] = useState(
    props.contextEnabled
  )
  const [includeResearch, setIncludeResearch] = useState(true)
  const [keyMissing, setKeyMissing] = useState(false)
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  // Stick-to-bottom follows new messages only while the reader is
  // already near the bottom; scrolling up pins the view so older
  // messages can be read undisturbed.
  const stickRef = useRef(true)

  function onMessagesScroll() {
    const element = messagesRef.current

    if (!element) {
      return
    }

    stickRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }

  useEffect(() => {
    if (stickRef.current) {
      messagesRef.current?.scrollTo({
        top: messagesRef.current.scrollHeight,
      })
    }
  }, [messages, loading])

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

  // Per-project conversation: restore follows the open project,
  // and every message change saves (sends are rare, so no debounce
  // is needed). The ready gate keeps the pre-restore empty state
  // from wiping stored history. A mid-request close restores
  // without the pending answer: in-flight requests are never faked.
  useEffect(() => {
    let cancelled = false

    setRestored(false)

    kryom()
      .restoreChat()
      .then((result) => {
        if (!cancelled) {
          setMessages(result.restored ? result.messages : [])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRestored(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [props.workspaceRoot])

  useEffect(() => {
    if (!restored) {
      return
    }

    kryom().saveChat(messages).catch(() => undefined)
  }, [messages, restored])

  const consumedPromptNonce = useRef<number | null>(null)

  useEffect(() => {
    const pending = props.pendingPrompt

    if (!pending || pending.text.trim() === '') {
      return
    }

    if (consumedPromptNonce.current === pending.nonce) {
      return
    }

    consumedPromptNonce.current = pending.nonce

    if (loading) {
      setPrompt(pending.text)
      return
    }

    setPrompt('')
    void sendWithText(pending.text.trim())
    // Consumes one welcome submit per nonce; sendWithText reads the
    // latest messages/model from this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingPrompt])

  async function sendWithText(userPrompt: string) {
    if (!userPrompt || loading) {
      return
    }

    // Pre-flight: guide key setup instead of failing the request. A
    // status-check failure itself never blocks; the request reports
    // its own error in that case.
    try {
      const status = await kryom().getAIStatus()

      if (!status.modelKeyConfigured) {
        // The composer clears on send: hand the text back so a missing
        // key never eats the user's prompt.
        setPrompt(userPrompt)
        setKeyMissing(true)
        props.onStatus('AI model is not configured')
        return
      }
    } catch {
      // Fall through to the request path.
    }

    setError('')
    setKeyMissing(false)
    setLoading(true)

    const userMessage: ChatMessage = { role: 'user', content: userPrompt }

    try {
      const context = await buildContext()
      const history: KryomAIMessage[] = messages
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content }))

      const attachedResearch =
        includeResearch && props.researchSessionId
          ? props.researchSessionId
          : undefined

      const result = await kryom().askAI({
        prompt: userPrompt,
        context,
        history,
        model,
        ...(attachedResearch ? { researchSessionId: attachedResearch } : {}),
      })

      setMessages((previous) => [
        ...previous,
        userMessage,
        { role: 'assistant', content: result.answer, model: result.model },
      ])
      props.onStatus(`AI response received (${result.model})`)
    } catch (e) {
      setMessages((previous) => [...previous, userMessage])

      if (isCancelError(e)) {
        props.onStatus('AI request cancelled')
      } else {
        setError(errorMessage(e))
      }
    } finally {
      setLoading(false)
    }
  }

  function stopRequest() {
    kryom().cancelAI().catch(() => undefined)
  }

  async function sendMessage() {
    const userPrompt = prompt.trim()

    if (!userPrompt || loading) {
      return
    }

    setPrompt('')
    await sendWithText(userPrompt)
  }

  function clearChat() {
    if (loading) {
      return
    }

    setMessages([])
    setError('')
    props.onStatus('AI chat cleared')
  }

  async function copyMessage(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessage(index)
      setTimeout(() => setCopiedMessage(null), 1500)
    } catch {
      setError('Copy is unavailable in this context.')
    }
  }

  // One-line context summary for the compact toolbar; the full
  // explanation stays available as a tooltip.
  const contextShort =
    includeFileContext && props.activeFile
      ? `${props.fileName}${props.dirty ? ' •' : ''}`
      : includeFileContext
        ? 'workspace summary'
        : 'context off'
  const contextTitle =
    includeFileContext && props.activeFile
      ? `Context: ${props.fileName}${props.dirty ? ' (unsaved edits included)' : ''}`
      : includeFileContext
        ? 'No active file. A short workspace summary (~4,000 chars) is used instead.'
        : 'File context is disabled. Only your prompt and recent messages are sent.'

  return (
    <section className="ai-panel">
      <div className="ai-toolbar">
        <strong className="ai-toolbar-title">Kryom AI</strong>
        <select
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={loading}
          aria-label="AI model"
          title="Model for this conversation"
        >
          {MODELS.map((id) => (
            <option key={id} value={id}>
              {id === 'muse-spark-1.3' ? 'Muse Spark 1.3' : 'Muse Wonder 1.0'}
            </option>
          ))}
        </select>
        <label
          className="ai-toolbar-check"
          title="Sends the active file (first ~18,000 characters, unsaved edits included) with each request"
        >
          <input
            type="checkbox"
            checked={includeFileContext}
            onChange={(event) => setIncludeFileContext(event.target.checked)}
          />
          Context
        </label>
        <span className="ai-toolbar-context muted" title={contextTitle}>
          {contextShort}
        </span>
        {props.researchSessionId && (
          <span className="ai-toolbar-research">
            <label
              className="ai-toolbar-check"
              title={`Research brief ${props.researchSessionId} is attached as cited context`}
            >
              <input
                type="checkbox"
                checked={includeResearch}
                onChange={(event) => setIncludeResearch(event.target.checked)}
              />
              Research
            </label>
            <button
              type="button"
              className="mini-btn"
              onClick={() => props.onDetachResearch?.()}
              disabled={loading}
              title="Detach the research brief from this conversation"
            >
              Detach
            </button>
          </span>
        )}
        <span className="spacer" />
        <button
          onClick={clearChat}
          disabled={loading || messages.length === 0}
          title="Clear conversation"
        >
          Clear
        </button>
      </div>

      <div
        ref={messagesRef}
        onScroll={onMessagesScroll}
        className="ai-messages"
        aria-live="polite"
      >
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
              <span>
                {message.role === 'user'
                  ? 'YOU'
                  : `KRYOM AI${message.model ? ` · ${message.model}` : ''}`}
              </span>
              <button
                type="button"
                className="mini-btn"
                onClick={() => void copyMessage(message.content, index)}
                title="Copy message text"
              >
                {copiedMessage === index ? 'Copied' : 'Copy'}
              </button>
            </div>
            {message.role === 'user' ? (
              <p className="md-para">{message.content}</p>
            ) : (
              <MarkdownLite text={message.content} />
            )}
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

      {keyMissing && !loading && (
        <AiKeyNotice onOpenConnections={props.onOpenConnections} />
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
          rows={3}
          maxLength={12000}
          disabled={loading}
        />

        <div className="composer-footer">
          <span className="muted">{prompt.length}/12000</span>
          {loading ? (
            <button type="button" onClick={stopRequest}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!prompt.trim()}>
              Send ↑
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
