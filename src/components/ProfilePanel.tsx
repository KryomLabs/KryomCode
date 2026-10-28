import { useEffect, useState } from 'react'
import { kryom } from '../api/kryom'
import { modelDisplayName } from '../utils/models'
import { baseName } from '../utils/paths'

export interface ProfilePanelProps {
  workspaceRoot: string | null
  defaultModel: string
  summary: KryomWorkspaceSummary | null
  onOpenSettings: () => void
  onOpenAbout: () => void
}

// Local profile: everything shown is verified on this machine. There
// is no cloud account yet, so sign-in is labelled Coming soon.
export function ProfilePanel(props: ProfilePanelProps) {
  const [version, setVersion] = useState<KryomAppVersion | null>(null)

  useEffect(() => {
    kryom()
      .getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(null))
  }, [])

  return (
    <section className="side-view" aria-label="Profile">
      <div className="side-header">
        <span className="side-title">PROFILE</span>
      </div>

      <div className="profile-card">
        <div className="profile-avatar" aria-hidden="true">
          K
        </div>
        <div>
          <p className="profile-name">Local workspace profile</p>
          <p className="muted">No account connected</p>
        </div>
      </div>

      <dl className="connect-facts profile-facts">
        <div>
          <dt>App</dt>
          <dd>KryomCode{version ? ` ${version.version}` : ''}</dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd>{version?.platform ?? 'unknown'}</dd>
        </div>
        <div>
          <dt>Default model</dt>
          <dd>{modelDisplayName(props.defaultModel)}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>
            {props.workspaceRoot ? baseName(props.workspaceRoot) : 'none open'}
          </dd>
        </div>
        {props.summary && (
          <div>
            <dt>Files</dt>
            <dd>
              {props.summary.counts.files} files ·{' '}
              {props.summary.projectType}
            </dd>
          </div>
        )}
      </dl>

      <div className="profile-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={props.onOpenSettings}
        >
          Settings
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={props.onOpenAbout}
        >
          About KryomCode
        </button>
      </div>

      <p className="muted padded">Cloud sign-in and sync — Coming soon.</p>
    </section>
  )
}
