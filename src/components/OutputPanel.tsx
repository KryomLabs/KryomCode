import { useEffect, useRef, useState } from 'react'
import {
  clearOutput,
  getOutput,
  subscribeOutput,
  type OutputEntry,
} from '../utils/output-log'

// Output tab: the renderer's application event log. Entries are real
// milestones and errors only; an empty log means a quiet session.
export function OutputPanel() {
  const [entries, setEntries] = useState<OutputEntry[]>(() => getOutput())
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribeOutput(setEntries), [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries.length])

  return (
    <section className="output-panel bottom-tab-panel" aria-label="Output">
      <div className="output-toolbar">
        <span className="muted">
          Application events{entries.length > 0 ? ` (${entries.length})` : ''}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="mini-btn"
          onClick={() => clearOutput()}
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </div>

      <div className="output-log" role="log" aria-label="Application event log">
        {entries.length === 0 && (
          <p className="muted padded">
            No events yet. Workspace, file, terminal, and AI activity is
            recorded here as it happens.
          </p>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className="output-line">
            <span className="output-time">{entry.at}</span>
            <span className="output-source">[{entry.source}]</span>
            <span className="output-message">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  )
}
