import { useCallback, useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { useDialogs } from './dialogs'

export interface MemoryPanelProps {
  workspaceRoot: string | null
  onStatus: (message: string) => void
}

interface SourceDraft {
  key: number
  kind: 'file' | 'chat' | 'research' | 'commit'
  value: string
}

let draftKey = 0

function nextDraft(kind: SourceDraft['kind'] = 'file'): SourceDraft {
  draftKey += 1

  return { key: draftKey, kind, value: '' }
}

function sourceLabel(source: KryomMemorySource): string {
  if (source.kind === 'file') {
    return `File: ${source.path ?? '(unknown)'}`
  }

  if (source.kind === 'chat') {
    return 'Chat history'
  }

  if (source.kind === 'research') {
    return `Research ${source.sessionId ?? '(unknown)'} (brief v${source.briefVersion ?? 0})`
  }

  return `Commit ${(source.sha ?? '').slice(0, 12)}`
}

function sourceStatus(source: KryomMemorySource): string {
  if (source.status === 'current') {
    return 'current'
  }

  return `${source.status}: ${source.reason}`
}

const SOURCE_PLACEHOLDERS: Record<SourceDraft['kind'], string> = {
  file: 'src/app.ts',
  chat: '',
  research: 'research session id',
  commit: '40-character commit SHA',
}

// Project memory: user-curated decisions, conventions, and facts with
// recorded provenance. Records live only in this project's `.kryom`
// folder; nothing here is sent anywhere by viewing it.
export function MemoryPanel(props: MemoryPanelProps) {
  const dialogs = useDialogs()
  const [records, setRecords] = useState<KryomMemoryRecord[]>([])
  const [corrupt, setCorrupt] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [forming, setForming] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formType, setFormType] = useState<KryomMemoryType>('fact')
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formSources, setFormSources] = useState<SourceDraft[]>([])
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    if (!props.workspaceRoot) {
      setRecords([])
      setCorrupt([])
      setSelectedId(null)

      return
    }

    setLoading(true)
    setError('')

    try {
      const listed = await kryom().listMemories()

      setRecords(listed.records)
      setCorrupt(listed.corrupt)

      if (selectedId && !listed.records.some((record) => record.id === selectedId)) {
        setSelectedId(null)
      }
    } catch (unknown) {
      setError(errorMessage(unknown))
    } finally {
      setLoading(false)
    }
  }, [props.workspaceRoot, selectedId])

  useEffect(() => {
    setForming(false)
    setEditingId(null)
    void reload()
  }, [reload])

  const selected = records.find((record) => record.id === selectedId) ?? null

  function startCreate() {
    setEditingId(null)
    setFormType('fact')
    setFormTitle('')
    setFormContent('')
    setFormSources([])
    setError('')
    setForming(true)
  }

  function startEdit(record: KryomMemoryRecord) {
    setEditingId(record.id)
    setFormType(record.type)
    setFormTitle(record.title ?? '')
    setFormContent(record.content)
    setFormSources(
      record.sources.map((source) => {
        const draft = nextDraft(source.kind)

        if (source.kind === 'file') {
          draft.value = source.path ?? ''
        } else if (source.kind === 'research') {
          draft.value = source.sessionId ?? ''
        } else if (source.kind === 'commit') {
          draft.value = source.sha ?? ''
        }

        return draft
      })
    )
    setError('')
    setForming(true)
  }

  function cancelForm() {
    setForming(false)
    setEditingId(null)
  }

  async function saveForm() {
    const specs: KryomMemorySourceSpec[] = []

    for (const draft of formSources) {
      if (draft.kind === 'chat') {
        specs.push({ kind: 'chat' })
      } else if (draft.value.trim()) {
        if (draft.kind === 'file') {
          specs.push({ kind: 'file', path: draft.value.trim() })
        } else if (draft.kind === 'research') {
          specs.push({ kind: 'research', sessionId: draft.value.trim() })
        } else {
          specs.push({ kind: 'commit', sha: draft.value.trim() })
        }
      }
    }

    setSaving(true)
    setError('')

    try {
      if (editingId) {
        const saved = await kryom().updateMemory({
          id: editingId,
          type: formType,
          title: formTitle.trim() ? formTitle.trim() : null,
          content: formContent,
          sources: specs,
        })

        setSelectedId(saved.id)
        props.onStatus('Memory updated')
      } else {
        const saved = await kryom().createMemory({
          type: formType,
          title: formTitle.trim() ? formTitle.trim() : undefined,
          content: formContent,
          sources: specs,
        })

        setSelectedId(saved.id)
        props.onStatus('Memory recorded')
      }

      setForming(false)
      setEditingId(null)
      await reload()
    } catch (unknown) {
      setError(errorMessage(unknown))
    } finally {
      setSaving(false)
    }
  }

  async function exportAll() {
    setError('')

    try {
      const result = await kryom().exportMemories()

      if (result.cancelled) {
        props.onStatus('Memory export cancelled')

        return
      }

      const skipped = result.skipped ?? []

      props.onStatus(
        `Exported ${result.exported ?? 0} ${result.exported === 1 ? 'memory' : 'memories'}${skipped.length > 0 ? ` (${skipped.length} unreadable skipped)` : ''}`
      )
    } catch (unknown) {
      setError(errorMessage(unknown))
    }
  }

  async function deleteAll() {
    if (records.length === 0) {
      return
    }

    const confirmed = await dialogs.confirm({
      title: 'Delete all memories',
      message: `Delete all ${records.length} ${records.length === 1 ? 'memory' : 'memories'} in this project? Chat history, checkpoints, and research data are kept. This cannot be undone.`,
      confirmLabel: 'Delete all',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    setError('')

    try {
      const result = await kryom().deleteAllMemories()

      setSelectedId(null)

      if (result.failed.length > 0) {
        setError(
          `Deleted ${result.deleted.length}, ${result.failed.length} failed: ${result.failed.map((entry) => `${entry.id} (${entry.reason})`).join('; ')}`
        )
      } else {
        props.onStatus(`Deleted ${result.deleted.length} ${result.deleted.length === 1 ? 'memory' : 'memories'}`)
      }

      await reload()
    } catch (unknown) {
      setError(errorMessage(unknown))
    }
  }

  async function deleteSelected(record: KryomMemoryRecord) {
    const confirmed = await dialogs.confirm({
      title: 'Delete memory',
      message: `Delete this ${record.type}${record.title ? ` (“${record.title}”)` : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    setError('')

    try {
      await kryom().deleteMemory({ id: record.id })
      setSelectedId(null)
      props.onStatus('Memory deleted')
      await reload()
    } catch (unknown) {
      setError(errorMessage(unknown))
    }
  }

  if (!props.workspaceRoot) {
    return (
      <section className="side-view" aria-label="Memory">
        <div className="side-header">
          <span className="side-title">MEMORY</span>
        </div>
        <p className="muted padded">Open a project folder to use memory.</p>
      </section>
    )
  }

  return (
    <section className="side-view" aria-label="Memory">
      <div className="side-header">
        <span className="side-title">MEMORY</span>
        <span className="memory-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void reload()}
            disabled={loading || saving}
          >
            Refresh
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={startCreate}
            disabled={loading || saving}
          >
            New
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void exportAll()}
            disabled={loading || saving || records.length === 0}
            title="Export memories to a JSON file"
          >
            Export
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void deleteAll()}
            disabled={loading || saving || records.length === 0}
            title="Delete all memories in this project"
          >
            Delete all
          </button>
        </span>
      </div>

      {error && (
        <p className="muted padded" role="alert">
          {error}
        </p>
      )}

      {corrupt.length > 0 && (
        <p className="muted padded" role="status">
          {corrupt.length} stored record{corrupt.length === 1 ? '' : 's'} could
          not be read ({corrupt.join(', ')}). {corrupt.length === 1 ? 'It stays' : 'They stay'} on
          disk under `.kryom/memory/`; delete{' '}
          {corrupt.length === 1 ? 'the file' : 'those files'} to clear this.
        </p>
      )}

      {loading && records.length === 0 ? (
        <p className="muted padded">Loading memories…</p>
      ) : (
        <ul className="memory-list">
          {records.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                className={
                  record.id === selectedId
                    ? 'memory-item selected'
                    : 'memory-item'
                }
                onClick={() => setSelectedId(record.id)}
                aria-pressed={record.id === selectedId}
              >
                <span className="memory-item-head">
                  <span className={`memory-type memory-type-${record.type}`}>
                    {record.type}
                  </span>
                  {record.stale && <span className="memory-stale">stale</span>}
                </span>
                <span className="memory-item-title">
                  {record.title || record.content.split('\n')[0]}
                </span>
                <span className="muted">
                  {record.sources.length} source{record.sources.length === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
          {records.length === 0 && (
            <li>
              <p className="muted padded">
                No memories yet. Record decisions, conventions, and facts so
                they survive restarts.
              </p>
            </li>
          )}
        </ul>
      )}

      {selected && !forming && (
        <article className="memory-detail" aria-label="Selected memory">
          <div className="memory-detail-head">
            <span className={`memory-type memory-type-${selected.type}`}>
              {selected.type}
            </span>
            {selected.stale && <span className="memory-stale">stale</span>}
          </div>
          {selected.title && <h3 className="memory-detail-title">{selected.title}</h3>}
          <p className="memory-detail-content">{selected.content}</p>
          <p className="muted">
            Updated {new Date(selected.updatedAt).toLocaleString()}
          </p>

          {selected.staleReasons.length > 0 && (
            <ul className="memory-reasons">
              {selected.staleReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}

          <h4 className="memory-subhead">Provenance</h4>
          {selected.sources.length === 0 ? (
            <p className="muted">No sources recorded.</p>
          ) : (
            <ul className="memory-sources">
              {selected.sources.map((source, index) => (
                <li key={`${source.kind}-${index}`}>
                  <span>{sourceLabel(source)}</span>{' '}
                  <span className="muted">({sourceStatus(source)})</span>
                </li>
              ))}
            </ul>
          )}

          <div className="memory-detail-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => startEdit(selected)}
              disabled={saving}
            >
              Edit
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void deleteSelected(selected)}
              disabled={saving}
            >
              Delete
            </button>
          </div>
        </article>
      )}

      {forming && (
        <form
          className="memory-form"
          aria-label={editingId ? 'Edit memory' : 'New memory'}
          onSubmit={(event) => {
            event.preventDefault()
            void saveForm()
          }}
        >
          <h3 className="memory-subhead">{editingId ? 'Edit memory' : 'New memory'}</h3>

          <label>
            Type
            <select
              value={formType}
              onChange={(event) => setFormType(event.target.value as KryomMemoryType)}
              disabled={saving}
            >
              <option value="fact">fact</option>
              <option value="decision">decision</option>
              <option value="convention">convention</option>
            </select>
          </label>

          <label>
            Title (optional)
            <input
              value={formTitle}
              onChange={(event) => setFormTitle(event.target.value)}
              placeholder="Short label"
              maxLength={200}
              disabled={saving}
            />
          </label>

          <label>
            Content
            <textarea
              value={formContent}
              onChange={(event) => setFormContent(event.target.value)}
              placeholder="What should be remembered?"
              rows={4}
              maxLength={20000}
              required
              disabled={saving}
            />
          </label>

          <fieldset className="memory-sources-edit">
            <legend>Sources</legend>
            <p className="muted">
              Sources are fingerprinted when saved; a changed source later
              marks the record stale.
            </p>
            {formSources.map((draft) => (
              <div key={draft.key} className="memory-source-row">
                <select
                  aria-label="Source kind"
                  value={draft.kind}
                  onChange={(event) =>
                    setFormSources((previous) =>
                      previous.map((item) =>
                        item.key === draft.key
                          ? { ...item, kind: event.target.value as SourceDraft['kind'] }
                          : item
                      )
                    )
                  }
                  disabled={saving}
                >
                  <option value="file">file</option>
                  <option value="chat">chat</option>
                  <option value="research">research</option>
                  <option value="commit">commit</option>
                </select>
                {draft.kind !== 'chat' && (
                  <input
                    aria-label={`${draft.kind} source value`}
                    value={draft.value}
                    onChange={(event) =>
                      setFormSources((previous) =>
                        previous.map((item) =>
                          item.key === draft.key
                            ? { ...item, value: event.target.value }
                            : item
                        )
                      )
                    }
                    placeholder={SOURCE_PLACEHOLDERS[draft.kind]}
                    disabled={saving}
                  />
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setFormSources((previous) =>
                      previous.filter((item) => item.key !== draft.key)
                    )
                  }
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() => setFormSources((previous) => [...previous, nextDraft()])}
              disabled={saving || formSources.length >= 20}
            >
              Add source
            </button>
          </fieldset>

          <div className="memory-detail-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={saving || !formContent.trim()}
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Record memory'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={cancelForm}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
