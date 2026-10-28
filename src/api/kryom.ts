// Typed access to the real desktop bridge plus shared error helpers.
// Every backend call in the UI goes through kryom() so a missing bridge
// fails loudly instead of silently.

export function kryom(): KryomAPI {
  if (!window.kryom) {
    throw new Error('Desktop bridge is unavailable. Restart KryomCode.')
  }

  return window.kryom
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'An unexpected error occurred.'
}

// Only the message crosses the IPC boundary, so conflict detection
// matches the backend's documented wording.
export function isWriteConflict(error: unknown): boolean {
  return error instanceof Error && /changed on disk/i.test(error.message)
}

// Cancellation surfaces as a rejected request whose message reports
// it (the provider was really aborted; this only classifies the
// outcome so the UI can show "cancelled" instead of an error box).
export function isCancelError(error: unknown): boolean {
  return error instanceof Error && /cancelled/i.test(error.message)
}
