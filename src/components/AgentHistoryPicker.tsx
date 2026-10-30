// Agent history picker (Advanced Agent, Part C). A compact entry
// point for attaching previous work as task context: the project's
// chat conversation, research sessions with briefs, and sibling
// agent sessions from the same project root. Candidates rank by
// token overlap with the search/task text, but NOTHING auto-injects
// — each ref is user-selected and removable. Project isolation is
// structural: chat/research IPC is project-scoped server-side, and
// agent siblings arrive pre-filtered to the session root.
import { useEffect, useMemo, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { rankHistoryCandidates } from './history-relevance'
import type { HistoryRef, MetaSession } from '../state/meta-sessions'

export interface AgentHistoryPickerProps {
  session: MetaSession
  // Same-root agent sessions, current session included (the picker
  // excludes it from the list itself).
  siblings: MetaSession[]
  workspaceRoot: string | null
  // Current composer draft: default ranking query when the picker's
  // own search box is empty.
  taskQuery: string
  onToggleRef: (ref: HistoryRef) => void
  onOpenSession: (sessionId: string) => void
  onStatus: (status: string) => void
}

interface Candidate {
  ref: HistoryRef
  detail: string
  updatedAt: string
  agentSessionId: string | null
}

export function AgentHistoryPicker(props: AgentHistoryPickerProps) {
  const [search, setSearch] = useState('')
  const [research, setResearch] = useState<KryomResearchSummary[]>([])
  const [researchError, setResearchError] = useState('')
  const [chatExcerpt, setChatExcerpt] = useState<KryomChatExcerpt | null>(null)
  const [chatError, setChatError] = useState('')

  const selected = useMemo(() => {
    const keys = new Set<string>()

    for (const ref of props.session.historyRefs) {
      keys.add(`${ref.kind}:${ref.id}`)
    }

    return keys
  }, [props.session.historyRefs])

  useEffect(() => {
    if (!props.workspaceRoot) {
      setResearch([])
      setChatExcerpt(null)
      return
    }

    let cancelled = false

    setResearchError('')
    setChatError('')

    kryom()
      .listResearch()
      .then(
        (rows) => {
          if (!cancelled) {
            setResearch(rows)
          }
        },
        (e: unknown) => {
          if (!cancelled) {
            setResearchError(errorMessage(e))
          }
        }
      )

    kryom()
      .getAgentChatExcerpt()
      .then(
        (excerpt) => {
          if (!cancelled) {
            setChatExcerpt(excerpt)
          }
        },
        (e: unknown) => {
          if (!cancelled) {
            setChatError(errorMessage(e))
          }
        }
      )

    return () => {
      cancelled = true
    }
  }, [props.workspaceRoot])

  const candidates = useMemo(() => {
    const rows: Candidate[] = []

    if (
      props.workspaceRoot &&
      chatExcerpt &&
      chatExcerpt.messageCount > 0
    ) {
      rows.push({
        ref: {
          kind: 'chat',
          id: props.workspaceRoot,
          label: 'Project chat',
        },
        detail:
          `${chatExcerpt.messageCount} message(s)` +
          (chatExcerpt.truncated ? ' · excerpt truncated' : ''),
        updatedAt: chatExcerpt.at,
        agentSessionId: null,
      })
    }

    for (const entry of research) {
      rows.push({
        ref: {
          kind: 'research',
          id: entry.id,
          label: entry.objective.slice(0, 160),
        },
        detail:
          `${entry.status} · ${entry.sources} source(s)` +
          (entry.briefVersion > 0 ? ` · brief v${entry.briefVersion}` : ''),
        updatedAt: entry.updatedAt,
        agentSessionId: null,
      })
    }

    for (const sibling of props.siblings) {
      if (sibling.id === props.session.id) {
        continue
      }

      rows.push({
        ref: {
          kind: 'agent',
          id: sibling.id,
          label: sibling.title.slice(0, 160),
        },
        detail:
          `${sibling.messages.length} message(s) · ` +
          `${sibling.changedFiles.length} file(s) changed`,
        updatedAt: sibling.updatedAt,
        agentSessionId: sibling.id,
      })
    }

    rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

    const query = search.trim() || props.taskQuery.trim()

    if (!query) {
      return rows
    }

    const lowered = search.trim().toLowerCase()
    const filtered = lowered
      ? rows.filter(
          (row) =>
            row.ref.label.toLowerCase().includes(lowered) ||
            row.detail.toLowerCase().includes(lowered)
        )
      : rows

    return rankHistoryCandidates(
      query,
      filtered.map((row) => ({
        id: `${row.ref.kind}:${row.ref.id}`,
        text: `${row.ref.label} ${row.detail}`,
      }))
    ).map(
      (ranked) =>
        filtered.find(
          (row) => `${row.ref.kind}:${row.ref.id}` === ranked.id
        ) as Candidate
    )
  }, [
    research,
    chatExcerpt,
    props.siblings,
    props.session.id,
    props.workspaceRoot,
    props.taskQuery,
    search,
  ])

  return (
    <section className="agent-history" aria-label="Attach history as context">
      <input
        aria-label="Search history"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search chat, research, and agent sessions…"
        maxLength={200}
      />

      {researchError && (
        <p className="inline-error" role="alert">
          Research list failed: {researchError}
        </p>
      )}
      {chatError && (
        <p className="muted" role="status">
          Chat excerpt unavailable: {chatError}
        </p>
      )}

      {!props.workspaceRoot && (
        <p className="muted">
          Open a project to browse its chat, research, and agent history.
        </p>
      )}

      {props.workspaceRoot && candidates.length === 0 && (
        <p className="muted">
          No history yet. Chat, research, and agent sessions for this
          project appear here once they exist.
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="tasks-list history-list">
          {candidates.map((candidate) => {
            const key = `${candidate.ref.kind}:${candidate.ref.id}`
            const attached = selected.has(key)

            return (
              <li key={key} className="tasks-row history-row">
                <span
                  className="history-label"
                  title={`${candidate.ref.kind} · ${candidate.ref.label}`}
                >
                  <span className="history-kind">{candidate.ref.kind}</span>{' '}
                  {candidate.ref.label}
                </span>
                <span className="muted">{candidate.detail}</span>
                {candidate.agentSessionId && (
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() =>
                      candidate.agentSessionId &&
                      props.onOpenSession(candidate.agentSessionId)
                    }
                    title="Open this session in an editor tab"
                  >
                    Open
                  </button>
                )}
                <button
                  type="button"
                  className="mini-btn"
                  aria-pressed={attached}
                  onClick={() => {
                    props.onToggleRef(candidate.ref)
                    props.onStatus(
                      attached
                        ? `Detached ${candidate.ref.label}`
                        : `Attached ${candidate.ref.label}`
                    )
                  }}
                  title={
                    attached
                      ? 'Remove from this task context'
                      : 'Attach to this task context'
                  }
                >
                  {attached ? 'Detach' : 'Attach'}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="muted">
        Attached history is sent as bounded context with requests from
        this session only. Project chat is one conversation per project.
      </p>
    </section>
  )
}
