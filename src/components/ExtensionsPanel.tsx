import { useCallback, useEffect, useState } from 'react'
import { kryom } from '../api/kryom'
import { modelDisplayName } from '../utils/models'

export interface ExtensionsPanelProps {
  workspaceRoot: string | null
  defaultModel: string
  terminalRunning: boolean
}

// Built-in capabilities, shown as the local extension set. Status chips
// reflect live checks; there is no marketplace yet and none is implied.
export function ExtensionsPanel(props: ExtensionsPanelProps) {
  const [inRepo, setInRepo] = useState<boolean | null>(null)
  const [aiReady, setAiReady] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    try {
      const status = await kryom().getAIStatus()
      setAiReady(status.modelKeyConfigured)
    } catch {
      setAiReady(null)
    }

    if (!props.workspaceRoot) {
      setInRepo(null)
      return
    }

    try {
      await kryom().gitStatus()
      setInRepo(true)
    } catch {
      setInRepo(false)
    }
  }, [props.workspaceRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rows: Array<{ name: string; detail: string; state: string; ok: boolean }> = [
    {
      name: 'Monaco Editor',
      detail: 'Multi-file editing, tabs, dirty tracking',
      state: 'Ready',
      ok: true,
    },
    {
      name: 'Terminal',
      detail: 'Workspace-scoped commands with cancel',
      state: props.terminalRunning ? 'Running' : 'Idle',
      ok: true,
    },
    {
      name: 'Git',
      detail: 'Status, diff, stage, commit, push',
      state:
        inRepo === null
          ? 'No project'
          : inRepo
            ? 'Repository found'
            : 'No repository',
      ok: inRepo === true,
    },
    {
      name: 'Diagnostics',
      detail: 'Build/test output parsed into Problems',
      state: props.workspaceRoot ? 'Ready' : 'Needs a project',
      ok: props.workspaceRoot !== null,
    },
    {
      name: 'AI Chat',
      detail: `Answers with ${modelDisplayName(props.defaultModel)}`,
      state:
        aiReady === null ? 'Unknown' : aiReady ? 'Key configured' : 'Key missing',
      ok: aiReady === true,
    },
    {
      name: 'Coding Agent',
      detail: 'Planned edits with approval and rollback',
      state:
        aiReady === null ? 'Unknown' : aiReady ? 'Key configured' : 'Key missing',
      ok: aiReady === true,
    },
    {
      name: 'Research',
      detail: 'Cited briefs from real paper search',
      state: props.workspaceRoot ? 'Ready' : 'Needs a project',
      ok: props.workspaceRoot !== null,
    },
    {
      name: 'Project Intelligence',
      detail: 'Summaries and bounded AI context',
      state: props.workspaceRoot ? 'Ready' : 'Needs a project',
      ok: props.workspaceRoot !== null,
    },
  ]

  return (
    <section className="side-view" aria-label="Extensions">
      <div className="side-header">
        <span className="side-title">EXTENSIONS · BUILT IN</span>
        <button type="button" className="mini-btn" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <ul className="ext-list">
        {rows.map((row) => (
          <li key={row.name} className="ext-row">
            <div className="ext-main">
              <span className="ext-name">{row.name}</span>
              <span className="muted">{row.detail}</span>
            </div>
            <span className={row.ok ? 'chip chip-ok' : 'chip'}>{row.state}</span>
          </li>
        ))}
      </ul>

      <p className="muted padded">
        Extension marketplace — Coming soon. Only the built-in set above
        is installed; nothing else can be added yet.
      </p>
    </section>
  )
}
