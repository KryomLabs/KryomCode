import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { joinName } from '../utils/paths'

export interface ProblemsPanelProps {
  workspaceRoot: string | null
  scripts: string[]
  onOpenFileAtLine: (path: string, line: number) => void
  onStatus: (status: string) => void
}

function suggestCommand(scripts: string[]): string {
  if (scripts.includes('build')) {
    return 'npm run build'
  }

  if (scripts.includes('test')) {
    return 'npm run test'
  }

  return 'npm test'
}

export function ProblemsPanel(props: ProblemsPanelProps) {
  const [command, setCommand] = useState('')
  const [result, setResult] = useState<KryomDiagnosticsResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!command && props.scripts.length > 0) {
      setCommand(suggestCommand(props.scripts))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scripts])

  function resolvePath(file: string): string {
    if (/^[A-Za-z]:[/\\]/.test(file) || file.startsWith('/')) {
      return file
    }

    return props.workspaceRoot ? joinName(props.workspaceRoot, file) : file
  }

  async function run() {
    const trimmed = command.trim()

    if (!props.workspaceRoot || running || !trimmed) {
      return
    }

    setRunning(true)
    setError('')

    try {
      const next = await kryom().runDiagnostics({ command: trimmed })
      setResult(next)
      props.onStatus(
        next.success
          ? `Diagnostics passed (${next.diagnostics.length} problem(s))`
          : 'Diagnostics failed'
      )
    } catch (e) {
      setResult(null)
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="problems-panel bottom-tab-panel">
      <form
        className="terminal-input"
        onSubmit={(event) => {
          event.preventDefault()
          void run()
        }}
      >
        <input
          aria-label="Build or test command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={
            props.workspaceRoot ? 'npm run build' : 'Open a project first…'
          }
          disabled={!props.workspaceRoot || running}
        />
        <button
          type="submit"
          disabled={!props.workspaceRoot || running || !command.trim()}
        >
          {running ? 'Running…' : 'Run'}
        </button>
      </form>

      {props.scripts.length > 0 && (
        <div className="script-chips">
          {props.scripts.slice(0, 8).map((script) => (
            <button
              key={script}
              type="button"
              className="secondary-button"
              disabled={running}
              onClick={() => setCommand(`npm run ${script}`)}
              title={`Run npm run ${script}`}
            >
              {script}
            </button>
          ))}
        </div>
      )}

      {error && <p className="inline-error padded">{error}</p>}

      {!result && !error && (
        <p className="muted padded">
          Run a build or test command to collect structured diagnostics.
        </p>
      )}

      {result && (
        <>
          <div
            className={`verdict ${result.success ? 'verdict-pass' : 'verdict-fail'}`}
            role="status"
          >
            {result.success ? 'Passed' : 'Failed'} · exit code {result.exitCode}
            {result.timedOut ? ' · timed out' : ''}
            {result.outputLimited ? ' · output truncated' : ''} ·{' '}
            {result.diagnostics.length} problem(s)
            {result.diagnosticsTruncated ? ' (list truncated)' : ''}
          </div>

          <div className="diagnostics-list">
            {result.diagnostics.map((diagnostic, index) => (
              <button
                key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${index}`}
                className="diagnostic-row"
                onClick={() =>
                  props.onOpenFileAtLine(
                    resolvePath(diagnostic.file),
                    diagnostic.line
                  )
                }
                title={`Open ${diagnostic.file}`}
              >
                <span className={`severity severity-${diagnostic.severity}`}>
                  {diagnostic.severity.toUpperCase()}
                </span>
                <span className="diagnostic-location">
                  {diagnostic.file}:{diagnostic.line}:{diagnostic.column}
                </span>
                <span className="diagnostic-message">
                  {diagnostic.code ? `${diagnostic.code} ` : ''}
                  {diagnostic.message}
                </span>
              </button>
            ))}

            {result.diagnostics.length === 0 && (
              <p className="muted padded">
                No parsed problems. Raw output is below.
              </p>
            )}
          </div>

          <details className="raw-output">
            <summary>Raw output</summary>
            <pre className="terminal-output">{result.output}</pre>
          </details>
        </>
      )}
    </section>
  )
}
