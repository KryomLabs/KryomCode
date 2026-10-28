// Shared model allowlist mirror for display only. The backend owns
// validation; unknown ids render as-is and are never sent anywhere
// from here.

export const MODELS = ['muse-spark-1.3', 'muse-wonder-1.0'] as const

export function modelDisplayName(modelId: string): string {
  if (modelId === 'muse-wonder-1.0') {
    return 'Muse Wonder 1.0'
  }

  if (modelId === 'muse-spark-1.3') {
    return 'Muse Spark 1.3'
  }

  return modelId
}
