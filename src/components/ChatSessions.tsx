// Chat sessions: a conversation tab bar over the single-session
// AiChat. Switching sets the backend active pointer, then remounts
// AiChat so it restores that session's own history; isolation is the
// backend's (save/restore always follow the active session id), the
// remount only refreshes the view. Rendered only on the home page;
// without an open project the bar hides and AiChat runs unpersisted
// exactly as before.
import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { AiChat, type AiChatProps } from './AiChat'
import { useDialogs } from './dialogs'

export type ChatSessionsProps = AiChatProps

export function ChatSessions(props: ChatSessionsProps) {
  const dialogs = useDialogs()
  const [sessions, setSessions] = useState<KryomChatSession[]>([])
  const [activeId, setActiveId] = useState('general')
  // Remount token, NOT the session id: AiChat must mount exactly
  // once per viewed session. It starts stable ('initial') so the
  // session-list load never remounts mid-send and loses a response;
  // only explicit view changes (switch/create/delete) rotate it.
  const [viewKey, setViewKey] = useState('initial')
  // Attachments are conversation-scoped: each session keeps its own
  // set across switches. The updater closes over the active id from
  // the render that started the attach, so files picked for one
  // conversation never land in another after a mid-attach switch.
  const [attachmentsBySession, setAttachmentsBySession] = useState<
    Record<string, KryomContextFile[]>
  >({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')

    if (!props.workspaceRoot) {
      setSessions([])
      setActiveId('general')
      return
    }

    kryom()
      .listChatSessions()
      .then((list) => {
        if (cancelled) {
          return
        }

        setSessions(list.sessions)
        setActiveId(list.activeId)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(errorMessage(e))
        }
      })

    return () => {
      cancelled = true
    }
  }, [props.workspaceRoot])

  async function switchTo(id: string) {
    if (busy || id === activeId) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const switched = await kryom().switchChatSession({ id })
      setActiveId(switched.id)
      setViewKey(switched.id)
      // Tab message counts refresh on list loads, not while chatting;
      // the active conversation itself is always current.
      props.onStatus(`Switched to ${switched.title}`)
    } catch (e: unknown) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    if (busy) {
      return
    }

    setBusy(true)
    setError('')

    try {
      // The backend names the session and makes it active.
      const created = await kryom().createChatSession()
      const list = await kryom().listChatSessions()
      setSessions(list.sessions)
      setActiveId(created.id)
      setViewKey(created.id)
      props.onStatus(`New conversation: ${created.title}`)
    } catch (e: unknown) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function renameActive() {
    const current = sessions.find((session) => session.id === activeId)

    if (busy || !current || current.id === 'general') {
      return
    }

    const title = await dialogs.prompt({
      title: 'Rename conversation',
      label: 'Title',
      initialValue: current.title,
      confirmLabel: 'Rename',
    })

    if (title === null) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const renamed = await kryom().renameChatSession({
        id: current.id,
        title,
      })
      setSessions((previous) =>
        previous.map((session) => (session.id === renamed.id ? renamed : session))
      )
      props.onStatus(`Renamed to ${renamed.title}`)
    } catch (e: unknown) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeActive() {
    const current = sessions.find((session) => session.id === activeId)

    if (busy || !current || current.id === 'general') {
      return
    }

    const confirmed = await dialogs.confirm({
      title: 'Delete conversation?',
      message: `“${current.title}” and its ${current.messageCount} message(s) will be permanently deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    setBusy(true)
    setError('')

    try {
      await kryom().deleteChatSession({ id: current.id })
      // The backend falls back to General when the active session
      // is deleted; the fresh list carries the true active id.
      const list = await kryom().listChatSessions()
      setSessions(list.sessions)
      setActiveId(list.activeId)
      setViewKey(list.activeId)
      props.onStatus('Conversation deleted')
    } catch (e: unknown) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const canManage = activeId !== 'general' && sessions.length > 0

  return (
    <div className="chat-sessions">
      {props.workspaceRoot !== null && sessions.length > 0 && (
        <div className="session-tabs" role="tablist" aria-label="Conversations">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              role="tab"
              aria-selected={session.id === activeId}
              className={
                session.id === activeId ? 'session-tab active' : 'session-tab'
              }
              onClick={() => void switchTo(session.id)}
              disabled={busy}
              title={`${session.title} · ${session.messageCount} message(s)`}
            >
              {session.title}
            </button>
          ))}
          <button
            type="button"
            className="mini-btn"
            onClick={() => void create()}
            disabled={busy}
            title="Start a new conversation"
          >
            + New
          </button>
          {canManage && (
            <span className="session-actions">
              <button
                type="button"
                className="mini-btn"
                onClick={() => void renameActive()}
                disabled={busy}
              >
                Rename
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => void removeActive()}
                disabled={busy}
              >
                Delete
              </button>
            </span>
          )}
        </div>
      )}
      {error !== '' && (
        <p className="inline-error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="mini-btn"
            onClick={() => setError('')}
          >
            Dismiss
          </button>
        </p>
      )}
      <AiChat
        {...props}
        key={viewKey}
        attachments={attachmentsBySession[activeId] ?? []}
        onAttachmentsChange={(updater) => {
          const id = activeId
          setAttachmentsBySession((previous) => ({
            ...previous,
            [id]: updater(previous[id] ?? []),
          }))
        }}
      />
    </div>
  )
}
