import { useEffect, useState } from 'react'
import { kryom } from '../api/kryom'

export interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export function AboutDialog(props: AboutDialogProps) {
  const [version, setVersion] = useState<KryomAppVersion | null>(null)

  useEffect(() => {
    if (!props.open) {
      return
    }

    kryom()
      .getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(null))

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
        className="dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="About KryomCode"
      >
        <div className="about-brand">
          <span className="about-mark" aria-hidden="true">
            K
          </span>
          <div>
            <h2 className="about-title">KryomCode</h2>
            <p className="muted">
              AI-assisted desktop coding workspace by KryomLabs
            </p>
          </div>
        </div>

        <dl className="connect-facts">
          <div>
            <dt>Version</dt>
            <dd>{version?.version ?? 'unknown'}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{version?.electron ?? 'unknown'}</dd>
          </div>
          <div>
            <dt>Chrome</dt>
            <dd>{version?.chrome ?? 'unknown'}</dd>
          </div>
          <div>
            <dt>Node</dt>
            <dd>{version?.node ?? 'unknown'}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{version?.platform ?? 'unknown'}</dd>
          </div>
        </dl>

        <p className="muted">
          Help → Open Documentation Folder shows the bundled docs. AI
          features use your own locally configured API keys.
        </p>

        <div className="dialog-actions">
          <button
            type="button"
            className="primary-button"
            onClick={props.onClose}
            autoFocus
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
