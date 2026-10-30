// Session catalog loader for the slim Meta AI Agent tab. Resolves
// the provider's model catalog by id so the composer's model picker
// shows real configured models. All other session tracking (plans,
// research sessions, changed files, approvals, execution) remains
// internal to the session record and the embedded Agent/Research
// panels — this hook only feeds the picker, and one failure degrades
// to the session's stored model, never a broken tab.
import { useCallback, useEffect, useRef, useState } from 'react'
import { kryom } from '../api/kryom'
import type { MetaSession } from '../state/meta-sessions'

export interface MetaWorkspaceData {
  models: KryomProviderModelSummary[]
  refresh: () => void
}

export function useMetaWorkspaceData(
  session: MetaSession
): MetaWorkspaceData {
  const [models, setModels] = useState<KryomProviderModelSummary[]>([])
  const [refreshToken, setRefreshToken] = useState(0)
  const generationRef = useRef(0)

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1)
  }, [])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    const providerId = session.providerId

    void kryom()
      .listProviderModels({ providerId })
      .then(
        (result) => {
          if (generation === generationRef.current) {
            setModels(result.models)
          }
        },
        () => {
          // Catalog unavailable: the picker falls back to the
          // session's stored model.
        }
      )
  }, [session.providerId, refreshToken])

  return { models, refresh }
}
