// Renderer-side application event log. The Output panel renders this
// buffer: real milestones and errors from user-driven flows, newest
// last. Nothing is fabricated; quiet sessions show a short log.

export interface OutputEntry {
  id: number
  at: string
  source: string
  message: string
}

const MAX_ENTRIES = 500

let nextId = 1
let entries: OutputEntry[] = []
const listeners = new Set<(next: OutputEntry[]) => void>()

function timestamp(): string {
  const now = new Date()

  return now.toLocaleTimeString('en-GB', { hour12: false })
}

export function logOutput(source: string, message: string): void {
  const trimmed = message.trim()

  if (!trimmed) {
    return
  }

  entries = [
    ...entries,
    { id: nextId, at: timestamp(), source, message: trimmed.slice(0, 2000) },
  ].slice(-MAX_ENTRIES)
  nextId += 1

  for (const listener of listeners) {
    listener(entries)
  }
}

export function getOutput(): OutputEntry[] {
  return entries
}

export function clearOutput(): void {
  entries = []

  for (const listener of listeners) {
    listener(entries)
  }
}

export function subscribeOutput(
  listener: (next: OutputEntry[]) => void
): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
