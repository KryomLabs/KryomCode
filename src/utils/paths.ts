// Separator-agnostic path helpers for display and for building child
// paths. The backend resolves and validates everything; these helpers
// never bypass that.

export function baseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

export function joinName(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

export function parentDir(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  parts.pop()

  return parts.join('/') || filePath
}

// Resolves a possibly workspace-relative path (as reported by
// diagnostics and search) against the workspace root. Absolute
// paths pass through untouched.
export function resolveAgainstRoot(
  root: string | null,
  filePath: string
): string {
  if (/^[A-Za-z]:[/\\]/.test(filePath) || filePath.startsWith('/')) {
    return filePath
  }

  return root ? joinName(root, filePath) : filePath
}

// Separator- and case-tolerant path equality for matching reported
// paths (which may mix separators) against open tab paths.
export function samePath(a: string, b: string): boolean {
  const normA = a.replace(/\\/g, '/')
  const normB = b.replace(/\\/g, '/')

  return normA === normB || normA.toLowerCase() === normB.toLowerCase()
}
