// Shared model-catalog loader. Resolves a provider's registered models
// by id so pickers show real configured models; one failure degrades
// to the caller's stored model, never a broken picker.
import { useCallback, useEffect, useRef, useState } from 'react'
import { kryom } from '../api/kryom'

export interface ProviderModelsData {
  models: KryomProviderModelSummary[]
  refresh: () => void
}

export function useProviderModels(providerId: string): ProviderModelsData {
  const [models, setModels] = useState<KryomProviderModelSummary[]>([])
  const [refreshToken, setRefreshToken] = useState(0)
  const generationRef = useRef(0)

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1)
  }, [])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation

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
          // stored model.
        }
      )
  }, [providerId, refreshToken])

  return { models, refresh }
}
