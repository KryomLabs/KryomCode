import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'

export interface SettingsModalProps {
  open: boolean
  initial: KryomSettings
  onClose: () => void
  onSaved: (settings: KryomSettings) => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  autoSave: boolean
  onToggleAutoSave: () => void
  panelLeftWidth: number
  panelRightWidth: number
  onResetPanels: () => void
}

const MODELS = ['muse-spark-1.3', 'muse-wonder-1.0'] as const
const FONT_MIN = 10
const FONT_MAX = 24

export function SettingsModal(props: SettingsModalProps) {
  const [defaultModel, setDefaultModel] = useState(props.initial.defaultModel)
  const [aiContextEnabled, setAiContextEnabled] = useState(
    props.initial.aiContextEnabled
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (props.open) {
      setDefaultModel(props.initial.defaultModel)
      setAiContextEnabled(props.initial.aiContextEnabled)
      setError('')
    }
  }, [props.open, props.initial])

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

  async function save() {
    setSaving(true)
    setError('')

    try {
      const saved = await kryom().updateSettings({
        defaultModel,
        aiContextEnabled,
      })
      props.onSaved(saved)
      props.onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
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
      <div className="dialog settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <h2>Settings</h2>

        <label className="field-label">
          Default AI model
          <select
            value={defaultModel}
            onChange={(event) => setDefaultModel(event.target.value)}
            aria-label="Default AI model"
          >
            {MODELS.map((id) => (
              <option key={id} value={id}>
                {id === 'muse-spark-1.3' ? 'Muse Spark 1.3' : 'Muse Wonder 1.0'}
              </option>
            ))}
          </select>
        </label>

        <label className="context-toggle">
          <input
            type="checkbox"
            checked={aiContextEnabled}
            onChange={(event) => setAiContextEnabled(event.target.checked)}
          />
          Include active file context in AI requests by default
        </label>

        <div className="settings-row">
          <span id="settings-autosave-label">Auto Save</span>
          <button
            type="button"
            role="switch"
            aria-checked={props.autoSave}
            aria-labelledby="settings-autosave-label"
            className={props.autoSave ? 'switch on' : 'switch'}
            onClick={props.onToggleAutoSave}
          >
            <span className="switch-knob" aria-hidden="true" />
          </button>
        </div>

        <div className="settings-row">
          <span id="settings-font-label">Editor font size</span>
          <div
            className="stepper"
            role="group"
            aria-labelledby="settings-font-label"
          >
            <button
              type="button"
              className="mini-btn"
              onClick={() =>
                props.onFontSizeChange(Math.max(FONT_MIN, props.fontSize - 1))
              }
              disabled={props.fontSize <= FONT_MIN}
              aria-label="Decrease editor font size"
            >
              −
            </button>
            <span aria-live="polite">{props.fontSize}px</span>
            <button
              type="button"
              className="mini-btn"
              onClick={() =>
                props.onFontSizeChange(Math.min(FONT_MAX, props.fontSize + 1))
              }
              disabled={props.fontSize >= FONT_MAX}
              aria-label="Increase editor font size"
            >
              +
            </button>
          </div>
        </div>

        <div className="settings-row">
          <span>Theme</span>
          <select
            value="dark"
            disabled
            title="Light theme is not implemented yet"
            aria-label="Theme (dark only for now)"
          >
            <option value="dark">Dark</option>
          </select>
        </div>
        <p className="muted settings-note">Light theme — Coming soon.</p>

        <div className="settings-row">
          <span>Panel sizes</span>
          <button
            type="button"
            className="mini-btn"
            onClick={props.onResetPanels}
            title="Reset sidebar and right panel to default sizes"
          >
            Reset to defaults
          </button>
        </div>
        <p className="muted settings-note">
          Sidebar {props.panelLeftWidth}px · Right panel{' '}
          {props.panelRightWidth}px. Drag the dividers to resize; sizes
          persist automatically.
        </p>

        <p className="muted">
          API credentials live in your local .env file and are never shown
          here.
        </p>

        {error && (
          <div className="ai-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        <div className="dialog-actions">
          <button className="secondary-button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
