import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { useLocale } from '../i18n'
import { useFocusTrap } from '../hooks/useFocusTrap'

export interface DiagnosticsDialogProps {
  open: boolean
  onClose: () => void
  onStatus: (status: string) => void
}

export function DiagnosticsDialog(props: DiagnosticsDialogProps) {
  const { t } = useLocale()
  const dialogRef = useFocusTrap<HTMLDivElement>(props.open)
  const [bundle, setBundle] = useState<KryomSupportBundle | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [exported, setExported] = useState('')

  useEffect(() => {
    if (!props.open) {
      return
    }

    setBundle(null)
    setError('')
    setExported('')
    setWorking(true)

    kryom()
      .previewSupportBundle()
      .then(setBundle)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setWorking(false))

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

  async function runExport() {
    setWorking(true)
    setError('')

    try {
      const result = await kryom().exportSupportBundle()

      if (result.cancelled) {
        return
      }

      setExported(result.path ?? 'saved')
      props.onStatus(t('diagnostics.exportedStatus', { path: result.path ?? 'file' }))
    } catch (err) {
      setError(errorMessage(err))
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
        ref={dialogRef}
        className="dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('diagnostics.title')}
      >
        <h2 className="about-title">{t('diagnostics.title')}</h2>
        <p className="muted">{t('diagnostics.description')}</p>

        {error && (
          <div className="ai-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {working && !bundle && <p className="muted">{t('diagnostics.collecting')}</p>}

        {bundle && (
          <dl className="connect-facts">
            <div>
              <dt>{t('diagnostics.app')}</dt>
              <dd>{bundle.app.version} · {bundle.app.environment} · {bundle.app.channel}</dd>
            </div>
            <div>
              <dt>{t('diagnostics.runtime')}</dt>
              <dd>Electron {bundle.runtime.electron} · Node {bundle.runtime.node} · {bundle.runtime.platform}/{bundle.runtime.arch}</dd>
            </div>
            <div>
              <dt>{t('diagnostics.provider')}</dt>
              <dd>{bundle.providers.selectedProvider} / {bundle.providers.selectedModel}{bundle.providers.metaConfigured ? '' : ` ${t('diagnostics.keyMissing')}`}</dd>
            </div>
            <div>
              <dt>{t('diagnostics.project')}</dt>
              <dd>{bundle.features.workspaceOpen ? t('diagnostics.filesIndexed', { count: bundle.features.filesIndexed }) : t('diagnostics.noProject')}</dd>
            </div>
            <div>
              <dt>{t('diagnostics.extensions')}</dt>
              <dd>{t('diagnostics.extensionsActive', { active: bundle.features.extensionsActive, installed: bundle.features.extensionsInstalled })}</dd>
            </div>
            <div>
              <dt>{t('diagnostics.recentErrors')}</dt>
              <dd>{t('diagnostics.errorsRecorded', { count: bundle.recentErrors.length })}</dd>
            </div>
          </dl>
        )}

        {exported && <p className="muted">{t('diagnostics.savedTo', { path: exported })}</p>}

        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={props.onClose}
          >
            {t('diagnostics.close')}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={working || !bundle}
            onClick={() => void runExport()}
            autoFocus
          >
            {t('diagnostics.export')}
          </button>
        </div>
      </div>
    </div>
  )
}
