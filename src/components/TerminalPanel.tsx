import { useEffect, useRef, useState } from 'react'
import { kryom, errorMessage, isCancelError } from '../api/kryom'
import { confirmCommandRun } from '../utils/command-confirm'
import { useDialogs } from './dialogs'

export interface TerminalPanelProps {
  workspaceRoot: string | null
  onStatus: (status: string) => void
}

export interface TerminalRunEntry {
  id: number
  command: string
  result: KryomTerminalResult | null
}

// Shared terminal state and command execution. One controller instance owns
// the input, history, and running flags, so exactly one mounted view drives
// exactly one execution path no matter where the view is docked.
export interface TerminalController {
  command: string
  setCommand: (value: string) => void
  entries: TerminalRunEntry[]
  running: boolean
  runningList: KryomRunningProcess[]
  error: string
  runTerminalCommand: () => void
  recallCommand: (direction: -1 | 1) => void
  cancel: () => void
  refreshStatus: () => void
  clear: () => void
}

let nextEntryId = 1

export function useTerminalController(
  workspaceRoot: string | null,
  onStatus: (status: string) => void,
  requireConfirmAll = false
): TerminalController {
  const dialogs = useDialogs()
  const [command, setCommand] = useState('npm run build')
  const [entries, setEntries] = useState<TerminalRunEntry[]>([])
  const [running, setRunning] = useState(false)
  const [runningList, setRunningList] = useState<KryomRunningProcess[]>([])
  const [error, setError] = useState('')
  // Synchronous guard: state updates land after re-render, so two rapid
  // Run activations could both pass a `running` state check. The ref
  // closes that race so one controller never starts overlapping runs.
  const runningRef = useRef(false)
  // Command history for Up/Down recall. Position -1 means "current
  // draft", which is preserved while browsing history.
  const historyRef = useRef<string[]>([])
  const historyPos = useRef(-1)
  const draftRef = useRef('')

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

  function recallCommand(direction: -1 | 1) {
    const history = historyRef.current

    if (history.length === 0) {
      return
    }

    if (historyPos.current === -1) {
      if (direction > 0) {
        return
      }

      draftRef.current = command
      historyPos.current = history.length - 1
    } else {
      historyPos.current += direction

      if (historyPos.current < 0) {
        historyPos.current = -1
        setCommand(draftRef.current)
        return
      }

      if (historyPos.current >= history.length) {
        historyPos.current = history.length - 1
        return
      }
    }

    setCommand(history[historyPos.current])
  }

  async function runTerminalCommand() {
    const trimmed = command.trim()

    if (!workspaceRoot || runningRef.current || !trimmed) {
      return
    }

    // Claim the run slot before the async confirm so two rapid
    // activations cannot both pass the guard above.
    runningRef.current = true

    const approved = await confirmCommandRun(trimmed, {
      requireConfirmAll,
      classify: (text) =>
        kryom()
          .classifyCommand(text)
          .then((result) => result.warnings),
      confirm: (title, message, confirmLabel) =>
        dialogs.confirm({ title, message, confirmLabel, danger: true }),
    })

    if (!approved) {
      runningRef.current = false
      onStatus('Command run cancelled')
      return
    }

    if (historyRef.current[historyRef.current.length - 1] !== trimmed) {
      historyRef.current = [...historyRef.current, trimmed].slice(-50)
    }

    historyPos.current = -1

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
      onStatus(
        result.cancelled
          ? 'Command cancelled'
          : result.exitCode === 0 && !result.timedOut
            ? 'Command completed'
            : 'Command failed'
      )
    } catch (e) {
      setError(errorMessage(e))
      setEntries((previous) => previous.filter((entry) => entry.id !== id))
      // Main-process approval declines (native dialog Cancel) land
      // here as cancellations, not failures. React batches the clear
      // with the set above, so no error flashes.
      if (isCancelError(e)) {
        setError('')
        onStatus('Command run cancelled')
      } else {
        onStatus('Terminal error')
      }
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }

  async function cancel() {
    if (!runningRef.current) {
      return
    }

    try {
      const result = await kryom().cancelCommand()
      onStatus(`Cancelled ${result.killed} running command(s)`)
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

  function clear() {
    setEntries([])
    setError('')
  }

  return {
    command,
    setCommand,
    entries,
    running,
    runningList,
    error,
    runTerminalCommand: () => void runTerminalCommand(),
    recallCommand,
    cancel: () => void cancel(),
    refreshStatus: () => void refreshStatus(),
    clear,
  }
}

export interface TerminalPanelViewProps {
  controller: TerminalController
  workspaceRoot: string | null
}

export function TerminalPanelView(props: TerminalPanelViewProps) {
  const { controller } = props
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll) {
      // Reduced-motion users get an instant jump instead of a smooth
      // scroll; the content lands in the same place.
      const reduceMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

      bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'end' })
    }
  }, [controller.entries, autoScroll])

  return (
    <section className="terminal-panel bottom-tab-panel">
      <form
        className="terminal-input"
        onSubmit={(event) => {
          event.preventDefault()
          controller.runTerminalCommand()
        }}
      >
        <span className="prompt-symbol">&gt;</span>

        <input
          aria-label="Terminal command"
          value={controller.command}
          onChange={(event) => controller.setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              controller.recallCommand(-1)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              controller.recallCommand(1)
            }
          }}
          placeholder={
            props.workspaceRoot ? 'Enter a command…' : 'Open a project first…'
          }
          disabled={!props.workspaceRoot || controller.running}
        />

        <button
          type="submit"
          disabled={
            !props.workspaceRoot ||
            controller.running ||
            !controller.command.trim()
          }
        >
          {controller.running ? 'Running…' : 'Run'}
        </button>

        <button
          type="button"
          onClick={controller.cancel}
          disabled={!controller.running}
          title="Cancel running commands"
        >
          Cancel
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={controller.refreshStatus}
          title="Refresh running processes"
        >
          Status
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={controller.clear}
          disabled={controller.entries.length === 0 && !controller.error}
          title="Clear terminal output"
        >
          Clear
        </button>
      </form>

      <label className="terminal-autoscroll">
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(event) => setAutoScroll(event.target.checked)}
        />
        Auto-scroll to latest output
      </label>

      {controller.runningList.length > 0 && (
        <p className="muted padded">
          Running:{' '}
          {controller.runningList.map((item) => item.command).join(' · ')}
        </p>
      )}

      {controller.error && (
        <p className="inline-error padded">{controller.error}</p>
      )}

      <div className="terminal-log">
        {controller.entries.length === 0 && (
          <p className="muted padded">
            {props.workspaceRoot
              ? 'Enter a command to run it in the project folder.'
              : 'Open a project to run commands.'}
          </p>
        )}

        {controller.entries.map((entry) => (
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
                  {entry.result.timedOut ? ' · timed out' : ''}
                  {entry.result.outputLimited ? ' · output truncated' : ''}
                  {entry.result.cancelled
                    ? ' · cancelled'
                    : entry.result.exitCode === 0 && !entry.result.timedOut
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

// Self-contained terminal with its own controller. The app shell instead
// mounts one shared controller's view in a single dock at a time.
export function TerminalPanel(props: TerminalPanelProps) {
  const controller = useTerminalController(props.workspaceRoot, props.onStatus)

  return (
    <TerminalPanelView
      controller={controller}
      workspaceRoot={props.workspaceRoot}
    />
  )
}
