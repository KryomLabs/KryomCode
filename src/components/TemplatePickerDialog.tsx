// Create-project dialog (Level 3C, Phase 1): generates a new local
// project from a validated built-in template. Destination picking,
// collision preview, and confirmed generation all reuse the existing
// template engine — this dialog only presents its real results.
import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'

export interface TemplatePickerDialogProps {
  open: boolean
  onClose: () => void
  onGenerated: (destination: string) => void
  onStatus: (status: string) => void
}

type Step =
  | { kind: 'list' }
  | { kind: 'preview'; template: KryomTemplateSummary; destination: string; preview: KryomTemplatePreview }
  | { kind: 'done'; destination: string; files: number }

export function TemplatePickerDialog(props: TemplatePickerDialogProps) {
  const [templates, setTemplates] = useState<KryomTemplateSummary[]>([])
  const [corrupt, setCorrupt] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'list' })
  const [error, setError] = useState('')

  useEffect(() => {
    if (!props.open) {
      return
    }

    setStep({ kind: 'list' })
    setError('')
    setLoading(true)

    kryom()
      .listTemplates()
      .then((listed) => {
        setTemplates(listed.templates)
        setCorrupt(listed.corrupt)
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [props.open])

  useEffect(() => {
    if (!props.open) {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [props.open, props.onClose])

  if (!props.open) {
    return null
  }

  async function chooseDestination(
    template: KryomTemplateSummary
  ): Promise<void> {
    if (working) {
      return
    }

    setWorking(true)
    setError('')

    try {
      const picked = await kryom().pickTemplateDestination()

      if (!picked) {
        props.onStatus('Project creation cancelled')
        return
      }

      const preview = await kryom().previewTemplate({
        templateId: template.id,
        destination: picked.path,
      })

      setStep({
        kind: 'preview',
        template,
        destination: picked.path,
        preview,
      })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setWorking(false)
    }
  }

  async function generate(confirmed: Step & { kind: 'preview' }): Promise<void> {
    if (working) {
      return
    }

    setWorking(true)
    setError('')

    try {
      const result = await kryom().generateTemplate({
        templateId: confirmed.template.id,
        destination: confirmed.destination,
        confirmed: true,
      })

      setStep({
        kind: 'done',
        destination: result.destination,
        files: result.files.length,
      })
      props.onStatus(
        `Project created (${result.files.length} file(s))`
      )
      props.onGenerated(result.destination)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose()
        }
      }}
    >
      <div
        className="dialog template-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
      >
        <h2>Create project</h2>

        {loading && <p className="muted">Loading templates…</p>}

        {corrupt.length > 0 && (
          <p className="inline-error">
            {corrupt.length} template(s) unreadable and hidden.
          </p>
        )}

        {step.kind === 'list' && !loading && (
          <>
            {templates.length === 0 ? (
              <p className="muted">No project templates are installed.</p>
            ) : (
              <ul className="template-list">
                {templates.map((template) => (
                  <li key={template.id} className="template-row">
                    <span>
                      <strong>{template.name}</strong>
                      <span className="muted">
                        {' '}
                        · {template.language}
                        {template.framework ? ` · ${template.framework}` : ''}
                        {' · '}
                        {template.fileCount} file(s)
                      </span>
                      <span className="muted template-desc">
                        {template.description}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void chooseDestination(template)}
                      disabled={working}
                    >
                      {working ? '…' : 'Create…'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {step.kind === 'preview' && (
          <div className="template-preview">
            <p>
              <strong>{step.template.name}</strong> →{' '}
              <span title={step.destination}>{step.destination}</span>
            </p>
            <p className="muted">
              {step.preview.files.length} file(s) will be written
              {step.preview.empty ? ' into an empty folder.' : '.'}
            </p>
            {step.preview.collisions.length > 0 && (
              <p className="inline-error" role="alert">
                {step.preview.collisions.length} existing file(s) would
                be overwritten:{' '}
                {step.preview.collisions.slice(0, 6).join(', ')}
                {step.preview.collisions.length > 6 ? '…' : ''}
              </p>
            )}
            {step.preview.setup.commands.length > 0 && (
              <p className="muted">
                Setup afterwards (instructions only, nothing runs
                automatically):{' '}
                {step.preview.setup.commands.join(' · ')}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep({ kind: 'list' })}
                disabled={working}
              >
                Back
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void generate(step)}
                disabled={working}
              >
                {working ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        )}

        {step.kind === 'done' && (
          <p className="muted">
            Created {step.files} file(s) at {step.destination}. The
            project opens automatically.
          </p>
        )}

        {error && (
          <div className="ai-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setError('')}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
