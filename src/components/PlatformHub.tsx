import { useCallback, useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { useLocale, formatNumber } from '../i18n'

export interface PlatformHubProps {
  workspaceRoot: string | null
  onStatus: (status: string) => void
}

type PlatformTab =
  | 'providers'
  | 'extensions'
  | 'skills'
  | 'workflows'
  | 'integrations'
  | 'templates'
  | 'permissions'
  | 'updates'

const PLATFORM_TABS: Array<{ id: PlatformTab; label: string }> = [
  { id: 'providers', label: 'PROVIDERS' },
  { id: 'extensions', label: 'EXTENSIONS' },
  { id: 'skills', label: 'SKILLS' },
  { id: 'workflows', label: 'WORKFLOWS' },
  { id: 'integrations', label: 'INTEGRATIONS' },
  { id: 'templates', label: 'TEMPLATES' },
  { id: 'permissions', label: 'PERMS' },
  { id: 'updates', label: 'UPDATES' },
]

function renderUnknown(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }

  try {
    const text = JSON.stringify(value, null, 2)

    return (text ?? String(value)).slice(0, 4000)
  } catch {
    return String(value).slice(0, 4000)
  }
}

export function PlatformHub(props: PlatformHubProps) {
  const [tab, setTab] = useState<PlatformTab>('providers')

  return (
    <section className="agent-panel">
      <div className="ai-heading">
        <div>
          <strong>Platform</strong>
          <div className="muted">Providers · Extensions · Skills · Workflows · Integrations · Templates · Permissions</div>
        </div>
      </div>
      {!props.workspaceRoot && (
        <p className="muted padded">Some actions need an open project. Provider, extension, and permission management work without one.</p>
      )}
      <div className="stage-tabs" role="tablist" aria-label="Platform">
        {PLATFORM_TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'panel-tab active' : 'panel-tab'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'providers' && <ProvidersView onStatus={props.onStatus} />}
        {tab === 'extensions' && <ExtensionsView onStatus={props.onStatus} />}
        {tab === 'skills' && <SkillsView workspaceRoot={props.workspaceRoot} onStatus={props.onStatus} />}
        {tab === 'workflows' && <WorkflowsView workspaceRoot={props.workspaceRoot} onStatus={props.onStatus} />}
        {tab === 'integrations' && <IntegrationsView workspaceRoot={props.workspaceRoot} onStatus={props.onStatus} />}
        {tab === 'templates' && <TemplatesView onStatus={props.onStatus} />}
        {tab === 'permissions' && <PermissionsView onStatus={props.onStatus} />}
        {tab === 'updates' && <UpdatesView onStatus={props.onStatus} />}
      </div>
    </section>
  )
}

function ProvidersView(props: { onStatus: (status: string) => void }) {
  const [providers, setProviders] = useState<KryomProviderSummary[]>([])
  const [selection, setSelection] = useState<{ config: KryomProviderConfig; route: KryomProviderRoute } | null>(null)
  const [models, setModels] = useState<KryomProviderModelSummary[]>([])
  const [providerId, setProviderId] = useState('meta')
  const [modelId, setModelId] = useState('')
  const [test, setTest] = useState<KryomConnectionTest | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      const listed = await kryom().listProviders()
      setProviders(listed.providers)
      const current = await kryom().getProviderSelection()
      setSelection(current)
      setProviderId(current.config.selectedProvider)
      setModelId(current.config.selectedModel)
      const catalog = await kryom().listProviderModels({ providerId: current.config.selectedProvider })
      setModels(catalog.models)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function changeProvider(next: string) {
    setProviderId(next)
    setTest(null)
    setWorking(true)
    setError('')
    try {
      const catalog = await kryom().listProviderModels({ providerId: next })
      setModels(catalog.models)
      setModelId(catalog.models[0]?.modelId ?? '')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function saveSelection() {
    setWorking(true)
    setError('')
    try {
      await kryom().configureProvider({ selectedProvider: providerId, selectedModel: modelId })
      await refresh()
      props.onStatus(`Provider selection saved: ${providerId} / ${modelId}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function runTest(id: string) {
    setWorking(true)
    setError('')
    try {
      setTest(await kryom().testProvider({ providerId: id }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="agent-composer">
        <div className="composer-footer">
          <select value={providerId} onChange={(event) => void changeProvider(event.target.value)} aria-label="Provider">
            {providers.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.displayName}</option>
            ))}
          </select>
          <select value={modelId} onChange={(event) => setModelId(event.target.value)} aria-label="Model">
            {models.map((entry) => (
              <option key={entry.modelId} value={entry.modelId}>{entry.displayName}</option>
            ))}
          </select>
          <span className="spacer" />
          <button className="secondary-button" disabled={working || !modelId} onClick={() => void saveSelection()}>
            Save selection
          </button>
        </div>
        <p className="muted">Credentials come from environment variables. KryomCode never stores keys in settings or shows them here.</p>
      </div>
      <div className="plan-commands">
        {providers.map((entry) => (
          <div key={entry.id} className="command-row">
            <span><strong>{entry.displayName}</strong> ({entry.models.length} models)</span>
            <span className="muted">{entry.available ? 'available' : 'not configured'}{entry.auth.configured ? '' : ' · key missing'}</span>
            <button className="secondary-button" disabled={working} onClick={() => void runTest(entry.id)}>Test</button>
          </div>
        ))}
      </div>
      {selection && (
        <p className="muted">Active route: {selection.route.providerName} / {selection.route.displayName}</p>
      )}
      {test && (
        <div className="plan-commands">
          {test.checks.map((check) => (
            <div key={check.name} className="command-row">
              <span>{check.ok ? 'PASS' : 'FAIL'} — {check.name}</span>
              <span className="muted">{check.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExtensionsView(props: { onStatus: (status: string) => void }) {
  const [extensions, setExtensions] = useState<KryomExtensionEntry[]>([])
  const [picked, setPicked] = useState('')
  const [dev, setDev] = useState(false)
  const [detail, setDetail] = useState<KryomExtensionStatus | null>(null)
  const [commandArgs, setCommandArgs] = useState('{}')
  const [commandResult, setCommandResult] = useState<unknown>(undefined)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      setExtensions((await kryom().listExtensions()).extensions)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(action: () => Promise<unknown>, done: string) {
    setWorking(true)
    setError('')
    try {
      await action()
      setDetail(null)
      await refresh()
      props.onStatus(done)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function pickDirectory() {
    setWorking(true)
    setError('')
    try {
      const chosen = await kryom().pickExtensionDirectory()
      setPicked(chosen?.path ?? '')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function openDetail(id: string) {
    setWorking(true)
    setError('')
    setCommandResult(undefined)
    try {
      setDetail(await kryom().getExtension({ id }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function runCommand(id: string, commandId: string) {
    setWorking(true)
    setError('')
    try {
      let args: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(commandArgs || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>
        } else {
          throw new Error('args must be a JSON object')
        }
      } catch {
        throw new Error('Command args must be a JSON object.')
      }
      setCommandResult(await kryom().runExtensionCommand({ id, commandId, args }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="agent-composer">
        <div className="composer-footer">
          <button className="secondary-button" disabled={working} onClick={() => void pickDirectory()}>Choose folder…</button>
          <span className="muted">{picked || 'No folder chosen'}</span>
          <span className="spacer" />
          <label className="muted">
            <input type="checkbox" checked={dev} onChange={(event) => setDev(event.target.checked)} /> dev link
          </label>
          <button className="secondary-button" disabled={working || !picked} onClick={() => void run(() => kryom().installExtension({ path: picked, dev }), 'Extension installed (disabled by default)')}>
            Install
          </button>
        </div>
        <p className="muted">Local folders only. New extensions install disabled and never activate on their own.</p>
      </div>
      <div className="plan-commands">
        {extensions.length === 0 && <p className="muted">No extensions installed.</p>}
        {extensions.map((entry) => (
          <div key={entry.id} className="command-row">
            <button className="secondary-button" onClick={() => void openDetail(entry.id)}>{entry.manifest.name}</button>
            <span className="muted">{entry.id} · {entry.version} · {entry.source}{entry.enabled ? ' · enabled' : ''}{entry.active ? ' · active' : ''}</span>
            <span className="spacer" />
            {entry.enabled
              ? <button className="secondary-button" disabled={working} onClick={() => void run(() => kryom().disableExtension({ id: entry.id }), `Disabled ${entry.id}`)}>Disable</button>
              : <button className="secondary-button" disabled={working} onClick={() => void run(() => kryom().enableExtension({ id: entry.id }), `Enabled ${entry.id}`)}>Enable</button>}
            {entry.active
              ? <button className="secondary-button" disabled={working} onClick={() => void run(() => kryom().deactivateExtension({ id: entry.id }), `Deactivated ${entry.id}`)}>Deactivate</button>
              : <button className="secondary-button" disabled={working || !entry.enabled} onClick={() => void run(() => kryom().activateExtension({ id: entry.id }), `Activated ${entry.id}`)}>Activate</button>}
            <button className="secondary-button" disabled={working} onClick={() => void run(() => kryom().uninstallExtension({ id: entry.id }), `Uninstalled ${entry.id}`)}>Uninstall</button>
          </div>
        ))}
      </div>
      {extensions.some((entry) => entry.lastError) && (
        <div className="plan-commands">
          {extensions.filter((entry) => entry.lastError).map((entry) => (
            <p key={entry.id} className="muted">{entry.id}: {entry.lastError}</p>
          ))}
        </div>
      )}
      {detail && (
        <div className="plan-commands">
          <div className="command-row"><span><strong>{detail.manifest.name}</strong> — {detail.manifest.description || 'no description'}</span></div>
          <div className="command-row"><span>Permissions: {detail.manifest.permissions.join(', ') || 'none'}</span></div>
          <div className="agent-composer">
            <input value={commandArgs} onChange={(event) => setCommandArgs(event.target.value)} placeholder='Command args as JSON, e.g. {"name": "Ada"}' aria-label="Command args" />
          </div>
          {detail.commands.length === 0 && <p className="muted">No active commands. Activate the extension first.</p>}
          {detail.commands.map((command) => (
            <div key={command.id} className="command-row">
              <span>{command.title} ({command.id})</span>
              <button className="secondary-button" disabled={working} onClick={() => void runCommand(detail.id, command.id)}>Run</button>
            </div>
          ))}
          {commandResult !== undefined && (
            <pre className="muted padded">{renderUnknown(commandResult)}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function SkillsView(props: { workspaceRoot: string | null; onStatus: (status: string) => void }) {
  const [skills, setSkills] = useState<KryomSkillSummary[]>([])
  const [selected, setSelected] = useState<KryomSkillSummary | null>(null)
  const [task, setTask] = useState('')
  const [result, setResult] = useState<{ kind: string; skill: string; tool: string; result: unknown } | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      const listed = await kryom().listSkills()
      setSkills(listed.skills)
      setSelected((current) => (current ? listed.skills.find((entry) => entry.id === current.id) ?? null : null))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle(id: string, enabled: boolean) {
    setWorking(true)
    setError('')
    try {
      await kryom().setSkillEnabled({ id, enabled })
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function remove(id: string, scope: string) {
    setWorking(true)
    setError('')
    try {
      await kryom().deleteSkill({ id, scope: scope as 'user' | 'project' })
      setSelected(null)
      await refresh()
      props.onStatus(`Deleted skill ${id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function runSkill() {
    if (!selected) {
      return
    }
    setWorking(true)
    setError('')
    setResult(null)
    try {
      setResult(await kryom().runSkill({ skillId: selected.id, task }))
      props.onStatus(`Skill ${selected.id} finished`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="plan-commands">
        {skills.map((entry) => (
          <div key={entry.id} className="command-row">
            <button className="secondary-button" onClick={() => { setSelected(entry); setResult(null) }}>{entry.name}</button>
            <span className="muted">{entry.id} · {entry.scope}{entry.enabled ? '' : ' · disabled'}</span>
            <span className="spacer" />
            <button className="secondary-button" disabled={working} onClick={() => void toggle(entry.id, !entry.enabled)}>
              {entry.enabled ? 'Disable' : 'Enable'}
            </button>
            {(entry.scope === 'user' || entry.scope === 'project') && (
              <button className="secondary-button" disabled={working} onClick={() => void remove(entry.id, entry.scope)}>Delete</button>
            )}
          </div>
        ))}
      </div>
      {selected && (
        <div className="plan-commands">
          <div className="command-row"><span><strong>{selected.name}</strong> — {selected.description || 'no description'}</span></div>
          <div className="command-row"><span>Tools: {selected.tools.join(', ')}</span></div>
          <div className="command-row"><span>Permissions: {selected.permissions.join(', ')}</span></div>
          <div className="agent-composer">
            <textarea
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Task for this skill, e.g. Summarize the auth module"
            />
            <div className="composer-footer">
              <span className="muted">{props.workspaceRoot ? `Runs tool ${selected.entryTool}` : 'Open a project to run skills'}</span>
              <span className="spacer" />
              <button className="secondary-button" disabled={working || !task.trim() || !selected.enabled || !props.workspaceRoot} onClick={() => void runSkill()}>
                Run skill
              </button>
            </div>
          </div>
          {result && (
            <pre className="muted padded">{renderUnknown(result.result)}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function WorkflowsView(props: { workspaceRoot: string | null; onStatus: (status: string) => void }) {
  const [workflows, setWorkflows] = useState<KryomWorkflowSummary[]>([])
  const [selected, setSelected] = useState<KryomWorkflowSummary | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [task, setTask] = useState('')
  const [run, setRun] = useState<KryomWorkflowRun | null>(null)
  const [runs, setRuns] = useState<Array<{ id: string; workflowId: string; workflowName: string; state: string; createdAt: string }>>([])
  const [note, setNote] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      setWorkflows((await kryom().listWorkflows()).workflows)
      setRuns((await kryom().listWorkflowRuns()).runs)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function pick(entry: KryomWorkflowSummary) {
    setSelected(entry)
    setRun(null)
    const seed: Record<string, string> = {}
    for (const input of entry.inputs) {
      seed[input.name] = input.default
    }
    setInputs(seed)
  }

  async function start() {
    if (!selected) {
      return
    }
    setWorking(true)
    setError('')
    try {
      setRun(await kryom().startWorkflow({ workflowId: selected.id, task: task || undefined, inputs }))
      setRuns((await kryom().listWorkflowRuns()).runs)
      props.onStatus(`Workflow ${selected.id} started`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function act(next: (runId: string) => Promise<KryomWorkflowRun>, done: string) {
    if (!run) {
      return
    }
    setWorking(true)
    setError('')
    try {
      setRun(await next(run.id))
      setRuns((await kryom().listWorkflowRuns()).runs)
      props.onStatus(done)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function openRun(runId: string) {
    setWorking(true)
    setError('')
    try {
      setRun(await kryom().getWorkflowRun({ runId }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function remove(id: string, scope: string) {
    setWorking(true)
    setError('')
    try {
      await kryom().deleteWorkflow({ id, scope: scope as 'user' | 'project' })
      setSelected(null)
      await refresh()
      props.onStatus(`Deleted workflow ${id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      {!props.workspaceRoot && <p className="muted padded">Open a project to start workflow runs.</p>}
      <div className="plan-commands">
        {workflows.map((entry) => (
          <div key={entry.id} className="command-row">
            <button className="secondary-button" onClick={() => pick(entry)}>{entry.name}</button>
            <span className="muted">{entry.id} · {entry.steps.length} steps · {entry.scope}</span>
            <span className="spacer" />
            {(entry.scope === 'user' || entry.scope === 'project') && (
              <button className="secondary-button" disabled={working} onClick={() => void remove(entry.id, entry.scope)}>Delete</button>
            )}
          </div>
        ))}
      </div>
      {selected && (
        <div className="plan-commands">
          <div className="command-row"><span><strong>{selected.name}</strong> — {selected.description || 'no description'}</span></div>
          {selected.steps.map((step) => (
            <div key={step.id} className="command-row"><span>{step.title} ({step.kind})</span></div>
          ))}
          <div className="agent-composer">
            {selected.inputs.map((input) => (
              <input
                key={input.name}
                value={inputs[input.name] ?? ''}
                onChange={(event) => setInputs((current) => ({ ...current, [input.name]: event.target.value }))}
                placeholder={`${input.name}${input.description ? ` — ${input.description}` : ''}`}
                aria-label={input.name}
              />
            ))}
            <textarea value={task} onChange={(event) => setTask(event.target.value)} placeholder="Run task (optional)" />
            <div className="composer-footer">
              <span className="spacer" />
              <button className="secondary-button" disabled={working || !props.workspaceRoot} onClick={() => void start()}>
                Start run
              </button>
            </div>
          </div>
        </div>
      )}
      {run && (
        <div className="plan-commands">
          <div className="command-row"><span><strong>Run {run.id}</strong> — {run.state}</span></div>
          {run.steps.map((step) => (
            <div key={step.id} className="command-row">
              <span>{step.title}: {step.state}</span>
              {step.error && <span className="muted">{step.error}</span>}
            </div>
          ))}
          {run.outcome && <p className="muted">{run.outcome.reason}</p>}
          <div className="agent-composer">
            <div className="composer-footer">
              <button className="secondary-button" disabled={working} onClick={() => void act((runId) => kryom().advanceWorkflow({ runId }), 'Run advanced')}>Advance</button>
              <button className="secondary-button" disabled={working} onClick={() => void act((runId) => kryom().resumeWorkflow({ runId }), 'Run resumed')}>Resume</button>
              <button className="secondary-button" disabled={working} onClick={() => void act((runId) => kryom().cancelWorkflow({ runId }), 'Run cancelled')}>Cancel</button>
              <button className="secondary-button" disabled={working} onClick={() => void openRun(run.id)}>Refresh</button>
            </div>
            {run.state === 'awaiting-approval' && (
              <div className="composer-footer">
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Approval note (optional)" aria-label="Approval note" />
                <button className="secondary-button" disabled={working} onClick={() => void act((runId) => kryom().approveWorkflow({ runId, decision: 'approve', note: note || undefined }), 'Checkpoint approved')}>Approve</button>
                <button className="secondary-button" disabled={working} onClick={() => void act((runId) => kryom().approveWorkflow({ runId, decision: 'deny', note: note || undefined }), 'Checkpoint denied')}>Deny</button>
              </div>
            )}
          </div>
        </div>
      )}
      {runs.length > 0 && (
        <div className="plan-commands">
          {runs.map((entry) => (
            <div key={entry.id} className="command-row">
              <button className="secondary-button" onClick={() => void openRun(entry.id)}>{entry.id}</button>
              <span className="muted">{entry.workflowName} · {entry.state} · {entry.createdAt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IntegrationsView(props: { workspaceRoot: string | null; onStatus: (status: string) => void }) {
  const [integrations, setIntegrations] = useState<KryomIntegrationSummary[]>([])
  const [statuses, setStatuses] = useState<Record<string, KryomIntegrationStatus>>({})
  const [repositories, setRepositories] = useState<unknown[] | null>(null)
  const [history, setHistory] = useState<unknown>(undefined)
  const [limit, setLimit] = useState('20')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      setIntegrations((await kryom().listIntegrations()).integrations)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function loadStatus(id: string) {
    setWorking(true)
    setError('')
    try {
      const status = await kryom().getIntegrationStatus({ id })
      setStatuses((current) => ({ ...current, [id]: status }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function connect(id: string) {
    setWorking(true)
    setError('')
    try {
      await kryom().connectIntegration({ id })
      const status = await kryom().getIntegrationStatus({ id })
      setStatuses((current) => ({ ...current, [id]: status }))
      props.onStatus(`Integration ${id} connected`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function disconnect(id: string) {
    setWorking(true)
    setError('')
    try {
      await kryom().disconnectIntegration({ id })
      const status = await kryom().getIntegrationStatus({ id })
      setStatuses((current) => ({ ...current, [id]: status }))
      props.onStatus(`Integration ${id} disconnected`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function loadRepositories(id: string) {
    setWorking(true)
    setError('')
    try {
      setRepositories((await kryom().listIntegrationRepositories({ id })).repositories)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function loadHistory(id: string) {
    setWorking(true)
    setError('')
    try {
      const parsed = Number.parseInt(limit, 10)
      setHistory(await kryom().getIntegrationHistory({ id, limit: Number.isFinite(parsed) ? parsed : 20 }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      {!props.workspaceRoot && <p className="muted padded">Open a project to inspect repository state.</p>}
      <div className="plan-commands">
        {integrations.map((entry) => (
          <div key={entry.id} className="command-row">
            <button className="secondary-button" disabled={working} onClick={() => void loadStatus(entry.id)}>{entry.displayName}</button>
            <span className="muted">{entry.capabilities.join(', ')}</span>
            <span className="spacer" />
            {entry.methods.includes('repositories') && (
              <button className="secondary-button" disabled={working || !props.workspaceRoot} onClick={() => void loadRepositories(entry.id)}>Repos</button>
            )}
            {entry.methods.includes('history') && (
              <button className="secondary-button" disabled={working || !props.workspaceRoot} onClick={() => void loadHistory(entry.id)}>History</button>
            )}
            {entry.methods.includes('connect') && (
              <button className="secondary-button" disabled={working} onClick={() => void connect(entry.id)}>Connect</button>
            )}
            <button className="secondary-button" disabled={working} onClick={() => void disconnect(entry.id)}>Disconnect</button>
          </div>
        ))}
      </div>
      {Object.entries(statuses).map(([id, status]) => (
        <p key={id} className="muted">{id}: {status.connected ? 'connected' : status.state} — {status.detail}</p>
      ))}
      <div className="agent-composer">
        <div className="composer-footer">
          <span className="muted">History limit</span>
          <input value={limit} onChange={(event) => setLimit(event.target.value)} aria-label="History limit" />
        </div>
      </div>
      {repositories !== null && (
        <pre className="muted padded">{renderUnknown(repositories)}</pre>
      )}
      {history !== undefined && (
        <pre className="muted padded">{renderUnknown(history)}</pre>
      )}
    </div>
  )
}

function TemplatesView(props: { onStatus: (status: string) => void }) {
  const [templates, setTemplates] = useState<KryomTemplateSummary[]>([])
  const [selected, setSelected] = useState<KryomTemplateSummary | null>(null)
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [destination, setDestination] = useState('')
  const [preview, setPreview] = useState<KryomTemplatePreview | null>(null)
  const [result, setResult] = useState<KryomTemplateResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      setTemplates((await kryom().listTemplates()).templates)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function pick(entry: KryomTemplateSummary) {
    setSelected(entry)
    setPreview(null)
    setResult(null)
    setConfirmed(false)
    const seed: Record<string, string> = {}
    for (const variable of entry.variables) {
      seed[variable.name] = variable.default
    }
    setVariables(seed)
  }

  async function pickDestination() {
    setWorking(true)
    setError('')
    try {
      const chosen = await kryom().pickTemplateDestination()
      if (chosen) {
        setDestination(chosen.path)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function runPreview() {
    if (!selected) {
      return
    }
    setWorking(true)
    setError('')
    setResult(null)
    try {
      setPreview(await kryom().previewTemplate({ templateId: selected.id, destination, variables }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function generate() {
    if (!selected) {
      return
    }
    setWorking(true)
    setError('')
    try {
      const generated = await kryom().generateTemplate({ templateId: selected.id, destination, variables, confirmed })
      setResult(generated)
      setPreview(null)
      props.onStatus(`Project generated at ${generated.destination}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="plan-commands">
        {templates.map((entry) => (
          <div key={entry.id} className="command-row">
            <button className="secondary-button" onClick={() => pick(entry)}>{entry.name}</button>
            <span className="muted">{entry.id} · {entry.category} · {entry.language} · {entry.fileCount} files</span>
          </div>
        ))}
      </div>
      {selected && (
        <div className="plan-commands">
          <div className="command-row"><span><strong>{selected.name}</strong> — {selected.description || 'no description'}</span></div>
          <div className="agent-composer">
            {selected.variables.map((variable) => (
              <input
                key={variable.name}
                value={variables[variable.name] ?? ''}
                onChange={(event) => setVariables((current) => ({ ...current, [variable.name]: event.target.value }))}
                placeholder={`${variable.name}${variable.description ? ` — ${variable.description}` : ''}`}
                aria-label={variable.name}
              />
            ))}
            <div className="composer-footer">
              <button className="secondary-button" disabled={working} onClick={() => void pickDestination()}>Choose location…</button>
              <span className="muted">{destination || 'No destination chosen'}</span>
            </div>
            <div className="composer-footer">
              <span className="spacer" />
              <button className="secondary-button" disabled={working || !destination} onClick={() => void runPreview()}>Preview</button>
              <button className="secondary-button" disabled={working || !destination || !preview || (preview.collisions.length > 0 && !confirmed)} onClick={() => void generate()}>Generate</button>
            </div>
          </div>
        </div>
      )}
      {preview && (
        <div className="plan-commands">
          <div className="command-row"><span><strong>Preview</strong> — {preview.files.length} files into {preview.destination}</span></div>
          {preview.files.map((file) => (
            <div key={file.path} className="command-row"><span>{file.path}</span><span className="muted">{file.bytes} bytes</span></div>
          ))}
          {preview.collisions.length > 0 && (
            <div className="agent-composer">
              <p className="muted">{preview.collisions.length} existing file(s) would be overwritten: {preview.collisions.slice(0, 5).join(', ')}</p>
              <label className="muted">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirm overwrite
              </label>
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="plan-commands">
          <div className="command-row"><span><strong>Generated</strong> — {result.files.length} files at {result.destination}</span></div>
          {result.overwritten.length > 0 && <p className="muted">Overwritten: {result.overwritten.join(', ')}</p>}
          <p className="muted">{result.setup.instructions}</p>
          {result.setup.commands.length > 0 && (
            <p className="muted">Run these yourself — KryomCode never executes template commands: {result.setup.commands.join(' · ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function PermissionsView(props: { onStatus: (status: string) => void }) {
  const [catalog, setCatalog] = useState<KryomPermissionInfo[]>([])
  const [grants, setGrants] = useState<KryomGrantEntry[]>([])
  const [events, setEvents] = useState<KryomAuditEvent[]>([])
  const [subject, setSubject] = useState('')
  const [permission, setPermission] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      const listed = await kryom().listPermissions()
      setCatalog(listed.permissions)
      setPermission((current) => current || listed.permissions[0]?.id || '')
      setGrants((await kryom().listPermissionGrants()).grants)
      setEvents((await kryom().listAuditEvents({ limit: 100 })).events)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function grant() {
    setWorking(true)
    setError('')
    try {
      await kryom().grantPermission({ subject, permission })
      setSubject('')
      await refresh()
      props.onStatus(`Granted ${permission} to ${subject}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function revoke(entry: string, item?: string) {
    setWorking(true)
    setError('')
    try {
      await kryom().revokePermission(item ? { subject: entry, permission: item } : { subject: entry })
      await refresh()
      props.onStatus(item ? `Revoked ${item} from ${entry}` : `Revoked all grants from ${entry}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="agent-composer">
        <div className="composer-footer">
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject, e.g. extension:acme.hello" aria-label="Subject" />
          <select value={permission} onChange={(event) => setPermission(event.target.value)} aria-label="Permission">
            {catalog.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
          <button className="secondary-button" disabled={working || !subject.trim() || !permission} onClick={() => void grant()}>Grant</button>
        </div>
        <p className="muted">Grants apply at the next check. Revoking stops future operations immediately — it never rewrites history.</p>
      </div>
      <div className="plan-commands">
        {grants.length === 0 && <p className="muted">No grants recorded.</p>}
        {grants.map((entry) => (
          <div key={entry.subject} className="command-row">
            <span><strong>{entry.subject}</strong> ({entry.trust})</span>
            <span className="muted">{entry.permissions.map((item) => item.permission).join(', ')}</span>
            <span className="spacer" />
            <button className="secondary-button" disabled={working} onClick={() => void revoke(entry.subject)}>Revoke all</button>
          </div>
        ))}
      </div>
      {grants.flatMap((entry) => entry.permissions.map((item) => ({ entry, item }))).map(({ entry, item }) => (
        <div key={`${entry.subject}:${item.permission}`} className="command-row">
          <span className="muted">{entry.subject} — {item.label} [{item.risk}] · {item.grantedAt}</span>
          <span className="spacer" />
          <button className="secondary-button" disabled={working} onClick={() => void revoke(entry.subject, item.permission)}>Revoke</button>
        </div>
      ))}
      <div className="plan-commands">
        <div className="command-row"><span><strong>Security events</strong></span></div>
        {events.length === 0 && <p className="muted">No security events yet.</p>}
        {events.map((event, index) => (
          <div key={`${event.at}-${index}`} className="command-row">
            <span>{event.type}{event.outcome ? ` (${event.outcome})` : ''}</span>
            <span className="muted">{event.subject ?? '—'} · {event.at}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function UpdatesView(props: { onStatus: (status: string) => void }) {
  const { t } = useLocale()
  const [status, setStatus] = useState<KryomUpdateStatus | null>(null)
  const [check, setCheck] = useState<KryomUpdateCheck | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      setStatus(await kryom().getUpdateStatus())
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function runCheck() {
    setWorking(true)
    setError('')
    try {
      const result = await kryom().checkForUpdates()
      setCheck(result)
      props.onStatus(result.reason)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function download() {
    setWorking(true)
    setError('')
    try {
      const result = await kryom().downloadUpdate()
      await refresh()
      props.onStatus(t('updates.staged', { path: result.path, bytes: formatNumber(result.bytes) }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function clear() {
    setWorking(true)
    setError('')
    try {
      await kryom().clearStagedUpdate()
      setCheck(null)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="agent-composer">
        <div className="composer-footer">
          <span className="muted">
            {status ? t('updates.versionLine', { version: status.version, environment: status.environment, channel: status.channel }) : t('updates.loading')}
          </span>
          <span className="spacer" />
          <button className="secondary-button" disabled={working} onClick={() => void runCheck()}>
            {t('updates.check')}
          </button>
        </div>
        <p className="muted">
          {status && !status.feedConfigured ? t('updates.noFeed') : t('updates.feedNote')}
        </p>
      </div>
      {check && (
        <div className="plan-commands">
          <div className="command-row"><span>{check.reason}</span></div>
          {check.manifest && <p className="muted">{check.manifest.releaseNotes || t('updates.noNotes')}</p>}
          {check.available && (
            <div className="agent-composer">
              <div className="composer-footer">
                <span className="spacer" />
                <button className="secondary-button" disabled={working} onClick={() => void download()}>
                  {t('updates.download', { version: check.manifest?.version ?? '' })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {status?.staged && (
        <div className="plan-commands">
          <div className="command-row">
            <span>{t('updates.staged', { path: status.staged.path, bytes: formatNumber(status.staged.bytes) })}</span>
            <span className="spacer" />
            <button className="secondary-button" disabled={working} onClick={() => void clear()}>{t('updates.discard')}</button>
          </div>
          <p className="muted">{t('updates.stagedNote')}</p>
        </div>
      )}
    </div>
  )
}
