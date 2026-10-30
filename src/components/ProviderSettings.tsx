// Provider configuration (Level 3C, Phase 6): user-owned Meta API
// key management. Keys are entered masked, travel renderer → main
// only, and are encrypted with the OS credential vault before
// persisting. The renderer NEVER receives a stored key back — only
// configured/not-configured, the credential source, live connection
// checks, and the actual model catalog.
import { useCallback, useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { modelDisplayName } from '../utils/models'
import { useDialogs } from './dialogs'

export interface ProviderSettingsProps {
  onStatus: (status: string) => void
}

interface CheckRow {
  name: string
  ok: boolean
  detail: string
}

function sourceLabel(source: string): string {
  if (source === 'environment') {
    return 'Environment (.env) — development key, takes precedence'
  }

  if (source === 'vault') {
    return 'OS vault — your key from Settings'
  }

  return 'Not configured'
}

export function ProviderSettings(props: ProviderSettingsProps) {
  const dialogs = useDialogs()
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<KryomProviderSummary[]>([])
  const [selection, setSelection] = useState<{
    config: KryomProviderConfig
    route: KryomProviderRoute
  } | null>(null)
  const [keyStatus, setKeyStatus] = useState<KryomProviderKeyStatus | null>(null)
  const [models, setModels] = useState<KryomProviderModelSummary[]>([])
  const [vaultAvailable, setVaultAvailable] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [liveTesting, setLiveTesting] = useState(false)
  const [checks, setChecks] = useState<CheckRow[] | null>(null)
  const [live, setLive] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const providerId = 'meta'

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [listed, selected, status, catalog, aiStatus] = await Promise.all([
        kryom().listProviders(),
        kryom().getProviderSelection(),
        kryom().getProviderKeyStatus({ providerId }),
        kryom().listProviderModels({ providerId }),
        kryom().getAIStatus(),
      ])

      setProviders(listed.providers)
      setSelection(selected)
      setKeyStatus(status)
      setModels(catalog.models)
      setVaultAvailable(aiStatus.vaultAvailable)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function saveKey(): Promise<void> {
    if (!apiKey.trim() || saving) {
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const result = await kryom().setProviderKey({
        providerId,
        apiKey: apiKey.trim(),
      })

      setApiKey('')
      setShowKey(false)
      setNotice(
        result.source === 'environment'
          ? 'Key saved to the OS vault. Your .env key still takes precedence.'
          : 'API key saved to the OS vault.'
      )
      props.onStatus('Provider API key saved')
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function removeKey(): Promise<void> {
    if (removing) {
      return
    }

    const confirmed = await dialogs.confirm({
      title: 'Remove API key?',
      message:
        'The key is removed from the OS vault. A .env key, if present, keeps working.',
      confirmLabel: 'Remove key',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    setRemoving(true)
    setError('')
    setNotice('')

    try {
      const result = await kryom().removeProviderKey({ providerId })

      setNotice(
        result.configured
          ? 'Vault key removed. An environment key is still configured.'
          : 'API key removed.'
      )
      props.onStatus('Provider API key removed')
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRemoving(false)
    }
  }

  async function runChecks(liveTest: boolean): Promise<void> {
    if (testing || liveTesting) {
      return
    }

    if (liveTest) {
      setLiveTesting(true)
    } else {
      setTesting(true)
    }

    setError('')
    setNotice('')

    try {
      const result = await kryom().testProvider({
        providerId,
        live: liveTest,
      })

      setChecks(result.checks)
      setLive(liveTest)
      props.onStatus(
        result.ok ? 'Provider connection verified' : 'Provider check failed'
      )
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setTesting(false)
      setLiveTesting(false)
    }
  }

  async function selectModel(modelId: string): Promise<void> {
    setError('')
    setNotice('')

    try {
      const config = await kryom().configureProvider({
        selectedModel: modelId,
      })

      setSelection((previous) =>
        previous ? { ...previous, config } : previous
      )
      setNotice(`Model set to ${modelDisplayName(modelId)}.`)
      props.onStatus('Provider model updated')
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function selectProvider(nextId: string): Promise<void> {
    setError('')
    setNotice('')

    try {
      await kryom().configureProvider({ selectedProvider: nextId })
      setNotice('Provider selection updated.')
      props.onStatus('Provider selection updated')
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (loading && !selection) {
    return <p className="muted padded">Loading provider settings…</p>
  }

  const configured = keyStatus?.configured === true
  const source = keyStatus?.source ?? 'missing'

  return (
    <div className="provider-settings">
      <div className="provider-status-row">
        <strong>Meta AI · Muse</strong>
        <span className={configured ? 'chip chip-ok' : 'chip chip-warn'}>
          {configured ? 'Configured' : 'Not configured'}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="mini-btn"
          onClick={() => void reload()}
          disabled={loading}
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <p className="muted">{sourceLabel(source)}</p>

      {!vaultAvailable && (
        <div className="ai-error" role="alert">
          <strong>Secure storage unavailable</strong>
          <p>
            This system offers no OS credential encryption, so keys
            cannot be saved here. Use the MODEL_API_KEY environment
            variable instead. Nothing was stored.
          </p>
        </div>
      )}

      <label className="field-label">
        {configured ? 'Replace API key' : 'API key'}
        <span className="key-input-row">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configured
                ? 'Enter a new key to replace the stored one'
                : 'Paste your Meta API key'
            }
            autoComplete="off"
            spellCheck={false}
            aria-label="Meta API key"
          />
          <button
            type="button"
            className="mini-btn"
            onClick={() => setShowKey((visible) => !visible)}
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </span>
      </label>

      <div className="provider-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => void saveKey()}
          disabled={saving || !apiKey.trim() || !vaultAvailable}
          title={
            vaultAvailable
              ? 'Encrypt and store the key in the OS vault'
              : 'Secure storage is unavailable'
          }
        >
          {saving ? 'Saving…' : configured ? 'Update key' : 'Save key'}
        </button>
        {configured && source === 'vault' && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void removeKey()}
            disabled={removing}
          >
            {removing ? 'Removing…' : 'Remove key'}
          </button>
        )}
      </div>

      <p className="muted">
        Stored keys are encrypted by your operating system and never
        shown again. A development key in <code>.env</code> keeps
        working and takes precedence; it is never copied here.
      </p>

      <div className="provider-status-row">
        <strong>Models</strong>
        <span className="muted">
          {selection
            ? `Active: ${modelDisplayName(selection.config.selectedModel)}`
            : ''}
        </span>
      </div>

      <label className="field-label">
        Active model
        <select
          value={selection?.config.selectedModel ?? ''}
          onChange={(event) => void selectModel(event.target.value)}
          aria-label="Active Meta model"
          disabled={models.length === 0}
        >
          {models.length === 0 && <option value="">No models listed</option>}
          {models.map((entry) => (
            <option key={entry.modelId} value={entry.modelId}>
              {entry.displayName}
              {entry.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>

      {providers.length > 1 && (
        <label className="field-label">
          Active provider
          <select
            value={selection?.config.selectedProvider ?? providerId}
            onChange={(event) => void selectProvider(event.target.value)}
            aria-label="Active provider"
          >
            {providers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
                {entry.available ? '' : ' (unavailable)'}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="provider-status-row">
        <strong>Connection</strong>
        <span className="spacer" />
        <button
          type="button"
          className="secondary-button"
          onClick={() => void runChecks(false)}
          disabled={testing || liveTesting}
          title="Local checks only: registration, enablement, key presence, models"
        >
          {testing ? 'Checking…' : 'Run checks'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void runChecks(true)}
          disabled={testing || liveTesting || !configured}
          title="Sends one minimal request to the provider"
        >
          {liveTesting ? 'Testing…' : 'Live test'}
        </button>
      </div>

      {checks && (
        <ul className="check-list">
          {checks.map((check) => (
            <li key={check.name} className="check-row">
              <span
                className={check.ok ? 'check-ok' : 'check-fail'}
                aria-label={check.ok ? 'passed' : 'failed'}
              >
                {check.ok ? '✓' : '✕'}
              </span>
              <span>
                <strong>{check.name}</strong>
                <span className="muted"> {check.detail}</span>
              </span>
            </li>
          ))}
          <li className="muted">
            {live ? 'Includes a live provider request.' : 'Local checks only.'}
          </li>
        </ul>
      )}

      {notice && (
        <p className="provider-notice" role="status">
          {notice}
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
    </div>
  )
}
