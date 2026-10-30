import { useCallback, useEffect, useState } from 'react'
import { kryom, errorMessage, isCancelError } from '../api/kryom'
import { modelDisplayName } from '../utils/models'
import { baseName } from '../utils/paths'
import { useDialogs } from './dialogs'

export interface ConnectionsPanelProps {
  workspaceRoot: string | null
  defaultModel: string
  activeFileName: string
  activeFileContent: string
  onStatus: (status: string) => void
  onOpenSourceControl: () => void
  onCloneRepository: (url: string) => Promise<void>
  onCreateReport: (template: string) => void
  onExportActiveFile: (template: string) => void
  onImportSave: (text: string, fileName: string) => void
}

interface VerifiedSession {
  url: string
  refs: number
  at: string
}

// Integration hub. GitHub status comes from verified git operations
// only (remote listing, ls-remote checks): there is no hardcoded
// "connected" state and KryomCode stores no tokens. Documents covers
// local Word-compatible export/import; Microsoft 365 cloud is planned.
export function ConnectionsPanel(props: ConnectionsPanelProps) {
  const dialogs = useDialogs()
  const [git, setGit] = useState<KryomGitStatus | null>(null)
  const [gitError, setGitError] = useState('')
  const [remotes, setRemotes] = useState<KryomGitRemote[]>([])
  const [aiStatus, setAiStatus] = useState<KryomAIStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [verified, setVerified] = useState<VerifiedSession | null>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [template, setTemplate] = useState('report')
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<KryomDocxImport | null>(null)
  const [importError, setImportError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setGitError('')

    try {
      setAiStatus(await kryom().getAIStatus())
    } catch {
      setAiStatus(null)
    }

    if (!props.workspaceRoot) {
      setGit(null)
      setRemotes([])
      setGitError('')
      setLoading(false)
      return
    }

    try {
      setGit(await kryom().gitStatus())
    } catch (e) {
      setGit(null)
      setGitError(errorMessage(e))
    }

    try {
      const listed = await kryom().gitRemotes()

      setRemotes(listed.remotes)
    } catch {
      setRemotes([])
    } finally {
      setLoading(false)
    }
  }, [props.workspaceRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Verification never survives a workspace switch: it describes the
  // repository at hand, not an account login.
  useEffect(() => {
    setVerified(null)
    setVerifyError('')
  }, [props.workspaceRoot])

  const inRepo = git !== null
  const primaryRemote =
    remotes.find((remote) => remote.name === 'origin') ?? remotes[0] ?? null

  async function verify(url: string) {
    const trimmed = url.trim()

    if (!trimmed || verifying) {
      return
    }

    setVerifying(true)
    setVerifyError('')

    try {
      const result = await kryom().gitVerify({ url: trimmed })

      setVerified({
        url: result.url,
        refs: result.refs.length,
        at: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      })
      props.onStatus(`Remote verified (${result.refs.length} branch(es) readable)`)
    } catch (e) {
      setVerified(null)

      if (isCancelError(e)) {
        props.onStatus('Remote verification cancelled')
      } else {
        setVerifyError(errorMessage(e))
      }
    } finally {
      setVerifying(false)
    }
  }

  // Verify and clone share one git kill switch: cancelling stops
  // whichever git child is running.
  function cancelGitOperation() {
    kryom().cancelGit().catch(() => undefined)
  }

  async function clone() {
    const url = await dialogs.prompt({
      title: 'Clone repository',
      label: 'GitHub repository URL',
      placeholder: 'https://github.com/owner/repo.git',
      confirmLabel: 'Choose folder & clone',
    })

    if (!url || cloning) {
      return
    }

    setCloning(true)

    try {
      await props.onCloneRepository(url)
    } finally {
      setCloning(false)
    }
  }

  async function importFile() {
    if (importing) {
      return
    }

    setImporting(true)
    setImportError('')
    setImportPreview(null)

    try {
      const result = await kryom().importDocx()

      if (!result) {
        props.onStatus('Import cancelled')
        return
      }

      setImportPreview(result)
      props.onStatus(`Imported ${result.fileName}`)
    } catch (e) {
      setImportError(errorMessage(e))
    } finally {
      setImporting(false)
    }
  }

  const hasActiveFile = props.activeFileContent.length > 0

  return (
    <section className="side-view" aria-label="Connections">
      <div className="side-header">
        <span className="side-title">CONNECTIONS</span>
        <button
          type="button"
          className="mini-btn"
          onClick={() => {
            void refresh()
            props.onStatus('Connections refreshed')
          }}
          disabled={loading}
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <div className="connect-list">
        <article className="connect-card">
          <header className="connect-head">
            <span className="connect-name">GitHub</span>
            <span
              className={
                verified
                  ? 'chip chip-ok'
                  : inRepo
                    ? 'chip chip-warn'
                    : 'chip'
              }
              title={
                verified
                  ? `Read access verified at ${verified.at}`
                  : 'No verified remote connection in this session'
              }
            >
              {verified ? 'Verified' : inRepo ? 'Unverified' : 'No repository'}
            </span>
          </header>

          {inRepo ? (
            <dl className="connect-facts">
              <div>
                <dt>Branch</dt>
                <dd>{git.branch ?? 'detached HEAD'}</dd>
              </div>
              <div>
                <dt>Upstream</dt>
                <dd>{git.upstream ?? 'none configured'}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{git.clean ? 'clean' : 'changes present'}</dd>
              </div>
              {remotes.length > 0 && (
                <div>
                  <dt>Remotes</dt>
                  <dd>
                    {remotes
                      .map((remote) => remote.name)
                      .join(', ')}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted">
              {props.workspaceRoot
                ? (gitError || 'This project is not a Git repository.')
                : 'Open a project to inspect its Git repository.'}
            </p>
          )}

          {verified ? (
            <p className="muted">
              Verified {verified.at}: {baseName(verified.url)} ·{' '}
              {verified.refs} branch(es) readable. Applies to this
              session only.
            </p>
          ) : (
            <p className="muted">
              Verification lists the remote&apos;s branches using your
              system Git credentials. Nothing is stored.
            </p>
          )}

          {verifyError && (
            <p className="inline-error" role="alert">
              {verifyError}
            </p>
          )}

          <div className="connect-actions">
            {primaryRemote?.fetchUrl && !verified && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void verify(primaryRemote.fetchUrl ?? '')}
                disabled={verifying}
                title={primaryRemote.fetchUrl}
              >
                {verifying ? 'Verifying…' : `Verify ${primaryRemote.name}`}
              </button>
            )}
            {verified && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setVerified(null)
                  props.onStatus('Remote verification cleared')
                }}
              >
                Disconnect
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => void clone()}
              disabled={cloning}
              title="Clone a GitHub repository into a new folder and open it"
            >
              {cloning ? 'Cloning…' : 'Clone / Open…'}
            </button>
            {(verifying || cloning) && (
              <button
                type="button"
                className="secondary-button"
                onClick={cancelGitOperation}
              >
                Cancel
              </button>
            )}
          </div>

          {!verified && (
            <form
              className="connect-verify-form"
              onSubmit={(event) => {
                event.preventDefault()
                void verify(customUrl)
              }}
            >
              <input
                value={customUrl}
                onChange={(event) => setCustomUrl(event.target.value)}
                placeholder="Or paste a repository URL to verify…"
                aria-label="Repository URL to verify"
                spellCheck={false}
                disabled={verifying}
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={verifying || !customUrl.trim()}
              >
                {verifying ? '…' : 'Verify'}
              </button>
            </form>
          )}

          <div className="connect-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={props.onOpenSourceControl}
              disabled={!props.workspaceRoot}
            >
              Open Source Control
            </button>
          </div>

          <p className="muted">
            Pull, push, stage, and commit run in Source Control through
            your system Git installation and its own credentials.
            KryomCode stores no GitHub tokens.
          </p>

          <p className="coming-soon">GitHub OAuth sign-in — Coming soon</p>
        </article>

        <article className="connect-card">
          <header className="connect-head">
            <span className="connect-name">Documents · Word</span>
            <span className="chip chip-ok">Local</span>
          </header>

          <p className="muted">
            Generate real .docx files on this machine and open in
            Microsoft Word, LibreOffice, or Google Docs. Research briefs
            keep their numbered citations and bibliography.
          </p>

          <label className="field-label">
            Template
            <select
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              aria-label="Document template"
            >
              <option value="report">Report</option>
              <option value="technical">Technical</option>
            </select>
          </label>

          <div className="connect-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => props.onCreateReport(template)}
              disabled={!props.workspaceRoot}
              title="Create a markdown report scaffold in the project"
            >
              Create report
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => props.onExportActiveFile(template)}
              disabled={!hasActiveFile}
              title={
                hasActiveFile
                  ? `Export ${props.activeFileName} to .docx`
                  : 'Open a file to export it'
              }
            >
              Export open file
            </button>
          </div>

          <p className="muted">
            Research briefs export from the Research mode, where the
            session&apos;s sources are attached.
          </p>

          <div className="connect-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void importFile()}
              disabled={importing}
            >
              {importing ? 'Importing…' : 'Import .docx…'}
            </button>
          </div>

          {importError && (
            <p className="inline-error" role="alert">
              {importError}
            </p>
          )}

          {importPreview && (
            <div className="import-preview">
              <p className="muted">
                {importPreview.fileName}
                {importPreview.truncated ? ' · truncated to 200k chars' : ''}
              </p>
              <pre className="terminal-output">
                {importPreview.text.slice(0, 600)}
                {importPreview.text.length > 600 ? '…' : ''}
              </pre>
              <div className="connect-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    props.onImportSave(importPreview.text, importPreview.fileName)
                  }
                  disabled={!props.workspaceRoot}
                  title="Save the imported text as markdown in the project and open it"
                >
                  Save to project & open
                </button>
              </div>
            </div>
          )}

          <p className="coming-soon">
            Microsoft 365 cloud sync — Planned, not implemented
          </p>
        </article>

        <article className="connect-card">
          <header className="connect-head">
            <span className="connect-name">Meta AI · Muse</span>
            <span
              className={
                aiStatus?.modelKeyConfigured ? 'chip chip-ok' : 'chip chip-warn'
              }
            >
              {aiStatus === null
                ? 'Unknown'
                : aiStatus.modelKeyConfigured
                  ? 'Key configured'
                  : 'Key missing'}
            </span>
          </header>

          <dl className="connect-facts">
            <div>
              <dt>Default model</dt>
              <dd>{modelDisplayName(props.defaultModel)}</dd>
            </div>
            <div>
              <dt>Key source</dt>
              <dd>
                {aiStatus === null
                  ? 'unknown'
                  : aiStatus.modelKeySource === 'environment'
                    ? 'environment (.env)'
                    : aiStatus.modelKeySource === 'vault'
                      ? 'OS vault (Settings)'
                      : 'not configured'}
              </dd>
            </div>
            <div>
              <dt>Research search</dt>
              <dd>
                {aiStatus === null
                  ? 'unknown'
                  : aiStatus.researchKeyConfigured
                    ? 'key configured'
                    : 'key missing (paper search limited)'}
              </dd>
            </div>
          </dl>

          <p className="muted">
            Add your own key in Settings → Providers (encrypted on
            this machine), or keep a development key in your local{' '}
            <code>.env</code> file (<code>MODEL_API_KEY</code>,{' '}
            <code>TAVILY_API_KEY</code>). Keys are never displayed
            here. Restart KryomCode after editing <code>.env</code>.
          </p>
        </article>

        <article className="connect-card">
          <header className="connect-head">
            <span className="connect-name">More integrations</span>
            <span className="chip">Coming soon</span>
          </header>
          <p className="muted">
            Additional providers plug in here without changing the rest
            of the workspace. Nothing listed yet.
          </p>
        </article>
      </div>
    </section>
  )
}
