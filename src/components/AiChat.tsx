import { useEffect, useRef, useState } from 'react'
import { kryom, errorMessage, isCancelError } from '../api/kryom'
import { classifyIntent } from './intent'
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
  // Workbench routing: offered explicitly on user messages that look
  // like coding tasks. Never fires silently — the user chooses.
  onOpenInAgent?: (text: string) => void
}

const MODELS = ['muse-spark-1.3', 'muse-wonder-1.0'] as const

// Appends stashed messages that are not already in the restored
// history (exact match), keeping the newest last. The backend caps
// stored history at 50 messages; the merged view matches.
function mergeMessages(disk: ChatMessage[], stashed: ChatMessage[]): ChatMessage[] {
  const seen = new Set(disk.map((entry) => JSON.stringify(entry)))
  const merged = [...disk]

  for (const entry of stashed) {
    const key = JSON.stringify(entry)

    if (!seen.has(key)) {
      seen.add(key)
      merged.push(entry)
    }
  }

  return merged.slice(-50)
}

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
  // Saves rejected as stale (two rapid project switches) wait here,
  // keyed by the root they belong to, until that project reopens.
  const pendingSavesRef = useRef(new Map<string, ChatMessage[]>())
  // Request generation: Stop invalidates the in-flight request so a
  // late provider response can never overwrite cancelled state.
  const sendGenerationRef = useRef(0)

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
  // Saves carry the root they were written for; a rejected stale
  // save is stashed and merged back when its project reopens.
  useEffect(() => {
    let cancelled = false
    const root = props.workspaceRoot

    setRestored(false)

    kryom()
      .restoreChat()
      .then((result) => {
        if (!cancelled) {
          const disk = result.restored ? result.messages : []
          const stashed = root ? pendingSavesRef.current.get(root) : undefined

          if (root && stashed && stashed.length > 0) {
            pendingSavesRef.current.delete(root)
            setMessages(mergeMessages(disk, stashed))
          } else {
            setMessages(disk)
          }
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

    const root = props.workspaceRoot

    kryom()
      .saveChat(messages, root)
      .then((result) => {
        // Only the longest stash per root wins: stale saves can
        // resolve out of order, and newer arrays are supersets.
        if (!result.saved && root) {
          const prev = pendingSavesRef.current.get(root)

          if (!prev || messages.length >= prev.length) {
            pendingSavesRef.current.set(root, messages)
          }
        }
      })
      .catch(() => undefined)
  }, [messages, restored, props.workspaceRoot])

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

    // Offline pre-flight: fail fast with a clear message instead of
    // appending the message and reporting a network error. A wrong
    // offline reading only delays the send; the request path still
    // reports its own error when online.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPrompt(userPrompt)
      setError(
        'You appear to be offline. Meta AI needs a network connection; your local workspace is unaffected.'
      )
      props.onStatus('Meta AI is offline')
      return
    }

    setError('')
    setKeyMissing(false)
    setLoading(true)

    const generation = sendGenerationRef.current + 1
    sendGenerationRef.current = generation
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

      if (generation !== sendGenerationRef.current) {
        return
      }

      setMessages((previous) => [
        ...previous,
        userMessage,
        { role: 'assistant', content: result.answer, model: result.model },
      ])
      props.onStatus(`AI response received (${result.model})`)
    } catch (e) {
      // Pure stop (no newer send): keep the user's message and only
      // drop the provider answer. Superseded sends drop everything.
      if (
        isCancelError(e) &&
        sendGenerationRef.current === generation + 1
      ) {
        setMessages((previous) => [...previous, userMessage])
        return
      }

      if (generation !== sendGenerationRef.current) {
        return
      }

      setMessages((previous) => [...previous, userMessage])

      if (isCancelError(e)) {
        props.onStatus('AI request cancelled')
      } else {
        setError(errorMessage(e))
      }
    } finally {
      if (generation === sendGenerationRef.current) {
        setLoading(false)
      }
    }
  }

  function stopRequest() {
    sendGenerationRef.current += 1
    setLoading(false)
    props.onStatus('AI request cancelled')
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
            <p className="muted">
              Ask about your code or request an explanation.
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
              {message.role === 'user' &&
                props.onOpenInAgent &&
                classifyIntent(message.content) === 'agent' && (
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => props.onOpenInAgent?.(message.content)}
                    title="Open this request as a Meta AI Agent task in an editor tab"
                  >
                    Open in Agent
                  </button>
                )}
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
          <span className="spacer" />
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
