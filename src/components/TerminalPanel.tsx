import { useEffect, useRef, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'

export interface TerminalPanelProps {
  workspaceRoot: string | null
  onStatus: (status: string) => void
}

interface RunEntry {
  id: number
  command: string
  result: KryomTerminalResult | null
}

let nextEntryId = 1

export function TerminalPanel(props: TerminalPanelProps) {
  const [command, setCommand] = useState('npm run build')
  const [entries, setEntries] = useState<RunEntry[]>([])
  const [running, setRunning] = useState(false)
  const [runningList, setRunningList] = useState<KryomRunningProcess[]>([])
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!running) {
      return
    }

    const timer = setInterval(() => {
      kryom()
        .getTerminalStatus()
        .then((status) => setRunningList(status.running))
        .catch(() => undefined)
    }, 2000)

    return () => clearInterval(timer)
  }, [running])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries])

  async function runTerminalCommand() {
    const trimmed = command.trim()

    if (!props.workspaceRoot || running || !trimmed) {
      return
    }

    const id = nextEntryId
    nextEntryId += 1

    setRunning(true)
    setError('')
    setEntries((previous) =>
      [...previous, { id, command: trimmed, result: null }].slice(-20)
    )

    try {
      const result = await kryom().runCommand(trimmed)

      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === id ? { ...entry, result } : entry
        )
      )
      setRunningList([])
      props.onStatus(
        result.exitCode === 0 && !result.timedOut
          ? 'Command completed'
          : 'Command failed'
      )
    } catch (e) {
      setError(errorMessage(e))
      setEntries((previous) => previous.filter((entry) => entry.id !== id))
      props.onStatus('Terminal error')
    } finally {
      setRunning(false)
    }
  }

  async function cancel() {
    if (!running) {
      return
    }

    try {
      const result = await kryom().cancelCommand()
      props.onStatus(`Cancelled ${result.killed} running command(s)`)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function refreshStatus() {
    try {
      const status = await kryom().getTerminalStatus()
      setRunningList(status.running)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <section className="terminal-panel bottom-tab-panel">
      <form
        className="terminal-input"
        onSubmit={(event) => {
          event.preventDefault()
          void runTerminalCommand()
        }}
      >
        <span className="prompt-symbol">&gt;</span>

        <input
          aria-label="Terminal command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={
            props.workspaceRoot ? 'Enter a command…' : 'Open a project first…'
          }
          disabled={!props.workspaceRoot || running}
        />

        <button
          type="submit"
          disabled={!props.workspaceRoot || running || !command.trim()}
        >
          {running ? 'Running…' : 'Run'}
        </button>

        <button
          type="button"
          onClick={() => void cancel()}
          disabled={!running}
          title="Cancel running commands"
        >
          Cancel
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={() => void refreshStatus()}
          title="Refresh running processes"
        >
          Status
        </button>
      </form>

      {runningList.length > 0 && (
        <p className="muted padded">
          Running: {runningList.map((item) => item.command).join(' · ')}
        </p>
      )}

      {error && <p className="inline-error padded">{error}</p>}

      <div className="terminal-log">
        {entries.length === 0 && (
          <p className="muted padded">
            {props.workspaceRoot
              ? 'Enter a command to run it in the project folder.'
              : 'Open a project to run commands.'}
          </p>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className="terminal-entry">
            <div className="terminal-command">&gt; {entry.command}</div>

            {!entry.result ? (
              <div className="ai-loading" role="status">
                <span className="loading-dot" />
                Running…
              </div>
            ) : (
              <>
                {entry.result.warnings.length > 0 && (
                  <div className="terminal-warnings" role="note">
                    {entry.result.warnings.map((warning, index) => (
                      <div key={index}>⚠ {warning} Review before trusting.</div>
                    ))}
                  </div>
                )}

                <pre className="terminal-output">{entry.result.output}</pre>

                <div className="muted">
                  Exit code: {entry.result.exitCode}
                  {entry.result.timedOut ? ' · timed out after 120 s' : ''}
                  {entry.result.outputLimited ? ' · output truncated' : ''}
                  {entry.result.exitCode === 0 && !entry.result.timedOut
                    ? ' · success'
                    : ' · failed'}
                </div>
              </>
            )}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>
    </section>
  )
}
