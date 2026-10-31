// Session catalog loader for the slim Meta AI Agent tab. Resolves
// the provider's model catalog by id so the composer's model picker
// shows real configured models. All other session tracking (plans,
// research sessions, changed files, approvals, execution) remains
// internal to the session record and the embedded Agent/Research
// panels — this hook only feeds the picker, and one failure degrades
// to the session's stored model, never a broken tab.
import { useProviderModels } from '../hooks/useProviderModels'
import type { MetaSession } from '../state/meta-sessions'

export interface MetaWorkspaceData {
  models: KryomProviderModelSummary[]
  refresh: () => void
}

export function useMetaWorkspaceData(
  session: MetaSession
): MetaWorkspaceData {
  const { models, refresh } = useProviderModels(session.providerId)

  return { models, refresh }
}
