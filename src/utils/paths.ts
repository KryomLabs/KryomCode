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
