// Minimal line diff for agent edit previews. Pure LCS with quadratic
// bounds: oversized inputs degrade to a truncated head preview that is
// clearly marked, never a fabricated full diff.

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

export interface DiffResult {
  lines: DiffLine[]
  truncated: boolean
}

const MAX_CELLS = 4_000_000
const FALLBACK_LINES = 100

function fallback(a: string[], b: string[]): DiffResult {
  return {
    lines: [
      ...a.slice(0, FALLBACK_LINES).map((text) => ({ type: 'del' as const, text })),
      ...b.slice(0, FALLBACK_LINES).map((text) => ({ type: 'add' as const, text })),
    ],
    truncated: true,
  }
}

export function diffLines(oldText: string, newText: string): DiffResult {
  const a = oldText.split('\n')
  const b = newText.split('\n')

  if (a.length * b.length > MAX_CELLS) {
    return fallback(a, b)
  }

  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Uint32Array(rows * cols)

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        table[i * cols + j] = table[(i + 1) * cols + (j + 1)] + 1
      } else {
        const skipA = table[(i + 1) * cols + j]
        const skipB = table[i * cols + (j + 1)]
        table[i * cols + j] = skipA >= skipB ? skipA : skipB
      }
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      lines.push({ type: 'del', text: a[i] })
      i += 1
    } else {
      lines.push({ type: 'add', text: b[j] })
      j += 1
    }
  }

  while (i < a.length) {
    lines.push({ type: 'del', text: a[i] })
    i += 1
  }

  while (j < b.length) {
    lines.push({ type: 'add', text: b[j] })
    j += 1
  }

  return { lines, truncated: false }
}
