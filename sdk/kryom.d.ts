/**
 * KryomCode Extension SDK (API v1).
 *
 * Types for the sandboxed `kryom` membrane plus the extension
 * manifest. Extensions run in a vm sandbox with no Node.js
 * globals: no require, process, fs, or network — only this API.
 *
 * Compatibility: manifests pin `apiVersion: 1`. Additive methods
 * may appear without breaking v1 manifests; breaking changes ship
 * a new major version.
 */

export type KryomPermission =
  | 'workspace.metadata'
  | 'workspace.read'
  | 'workspace.write'
  | 'terminal.execute'
  | 'network.access'
  | 'ai.provider'
  | 'ai.tools'
  | 'git.read'
  | 'git.write'
  | 'integrations.external'
  | 'templates.generate'
  | 'workflows.execute'

export type KryomErrorCode =
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'INVALID_ARGS'
  | 'NOT_ACTIVE'
  | 'UNKNOWN_COMMAND'
  | 'QUOTA_EXCEEDED'
  | 'EXTENSION_FAULT'

export interface KryomCommandContribution {
  /** Namespaced command id, e.g. "publisher.name". */
  id: string
  title: string
  description?: string
}

export interface KryomExtensionManifest {
  manifestVersion: 1
  /** Unique id shaped "publisher.name". */
  id: string
  name: string
  description?: string
  /** Semver x.y.z. */
  version: string
  publisher: string
  /** Relative .js entry path, no traversal. */
  main: string
  /** Must equal the host's supported API version (1). */
  apiVersion: 1
  engines?: { kryomcode?: string }
  permissions?: KryomPermission[]
  optionalPermissions?: KryomPermission[]
  contributes?: { commands?: KryomCommandContribution[] }
  dependencies?: Record<string, string>
}

export interface KryomWorkspaceMetadata {
  open: boolean
  /** Project folder name, or null when no project is open. */
  name: string | null
}

export interface KryomFileList {
  files: string[]
  truncated: boolean
}

export interface KryomFileContent {
  path: string
  content: string
  truncated: boolean
}

export interface KryomAiAnswer {
  answer: string
  model: string
  provider: string
}

export interface KryomCommands {
  registerCommand(id: string, handler: (args: Record<string, unknown>) => unknown): void
}

export interface KryomWorkspace {
  getMetadata(): Promise<KryomWorkspaceMetadata>
  listFiles(prefix?: string): Promise<KryomFileList>
  readFile(relativePath: string): Promise<KryomFileContent>
}

export interface KryomStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<boolean>
}

export interface KryomAi {
  complete(options: { prompt: string; model?: string }): Promise<KryomAiAnswer>
}

/** The frozen capability membrane every extension receives. */
export interface KryomExtensionAPI {
  /** API version the host implements (1). */
  version: number
  /** This extension's id. */
  extensionId: string
  /** Redacted, bounded host log. */
  log(message: string): void
  commands: KryomCommands
  workspace: KryomWorkspace
  storage: KryomStorage
  ai: KryomAi
}

export interface KryomExtensionModule {
  activate(api: KryomExtensionAPI): unknown
  deactivate?(): unknown
}
