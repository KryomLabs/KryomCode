interface KryomNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: KryomNode[]
}

interface KryomWorkspace {
  root: string
  tree: KryomNode[]
}

interface KryomAIMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
}

interface KryomAIResponse {
  answer: string
  model: string
  researchSessionId?: string
}

interface KryomFileMeta {
  content: string
  mtimeMs: number
  size: number
  path: string
}

interface KryomSearchMatch {
  path: string
  relativePath: string
  line?: number
  text?: string
}

interface KryomSearchResult {
  matches: KryomSearchMatch[]
  truncated: boolean
  searchedFiles: number
}

interface KryomTerminalResult {
  exitCode: number
  output: string
  timedOut: boolean
  outputLimited: boolean
  warnings: string[]
}

interface KryomRunningProcess {
  id: string
  command: string
  startedAt: number
}

interface KryomAgentEdit {
  index?: number
  path: string
  action: 'create' | 'modify' | 'delete'
  content?: string
  contentLength?: number
  preview?: string
  reason?: string
  originalDigest?: string
  originalLength?: number
}

interface KryomAgentContextFile {
  path: string
  relativePath: string
  bytes: number
}

interface KryomAgentContextExcluded {
  path: string
  reason: string
}

interface KryomAgentContextPreview {
  files: KryomAgentContextFile[]
  excluded: KryomAgentContextExcluded[]
  totalBytes: number
}

interface KryomAgentPlan {
  model: string
  task: string
  researchSessionId?: string
  contextFiles: KryomAgentContextFile[]
  contextExcluded: KryomAgentContextExcluded[]
  totalContextBytes: number
  edits: KryomAgentEdit[]
  commands: string[]
  notes: string
}

interface KryomAgentApplyResult {
  completed: boolean
  cancelled: boolean
  applied: Array<{ path: string; action: string }>
  failed: { message: string } | null
  rolledBack: boolean
}

interface KryomGitStatus {
  branch: string | null
  upstream: string | null
  toplevel: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  clean: boolean
}

interface KryomGitDiff {
  diff: string
  truncated: boolean
  staged: boolean
}

interface KryomDiagnostic {
  file: string
  line: number
  column: number
  severity: 'error' | 'warning'
  code: string | null
  message: string
  source: string
}

interface KryomDiagnosticsResult {
  success: boolean
  exitCode: number
  timedOut: boolean
  outputLimited: boolean
  warnings: string[]
  output: string
  diagnostics: KryomDiagnostic[]
  diagnosticsTruncated: boolean
}

interface KryomWorkspaceSummary {
  root: string
  projectType: string
  frameworks: string[]
  scripts: Record<string, string>
  description: string | null
  configs: string[]
  fileIndex: Array<{ relativePath: string; size: number }>
  counts: {
    files: number
    directories: number
    skipped: number
    truncated: boolean
  }
}

interface KryomWorkspaceContext {
  context: string
  truncated: boolean
  projectType: string
}

interface KryomSettings {
  defaultModel: string
  aiContextEnabled: boolean
  panelLeftWidth: number
  panelRightWidth: number
  panelBottomHeight: number
}

interface KryomResearchStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail: string
  error: string
  startedAt: string | null
  finishedAt: string | null
}

interface KryomResearchSource {
  provider: string
  title: string
  url: string
  authors: string[]
  publishedAt: string | null
  abstract: string
  venue: string
  doi: string | null
  sourceType: string
  accessStatus: string
  excerpt: string
}

interface KryomResearchFinding {
  claim: string
  sourceIndexes: number[]
  confidence: string
  note: string
}

interface KryomResearchSession {
  id: string
  version: number
  objective: string
  questions: string[]
  queries: Array<{ query: string; at: string }>
  steps: KryomResearchStep[]
  sources: KryomResearchSource[]
  evidence: Array<{ sourceUrl: string; excerpt: string; at: string }>
  findings: KryomResearchFinding[]
  decisions: Array<{ text: string; at: string }>
  brief: { version: number; markdown: string; generatedAt: string | null; via: string }
  implementationTasks: string[]
  verification: string[]
  errors: Array<{ where: string; message: string; at: string }>
  status: 'running' | 'completed' | 'blocked' | 'cancelled' | 'failed'
  statusDetail: string
  createdAt: string
  updatedAt: string
}

interface KryomResearchSummary {
  id: string
  objective: string
  status: string
  sources: number
  briefVersion: number
  updatedAt: string
  createdAt: string
}

interface KryomOpenFileResult {
  root: string
  tree: KryomNode[]
  filePath: string
}

interface KryomSaveAsResult {
  path: string
  content: string
  mtimeMs: number
}

interface KryomAppVersion {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

interface KryomAIStatus {
  modelKeyConfigured: boolean
  researchKeyConfigured: boolean
}

interface KryomUIState {
  autoSave: boolean
  recent: string[]
}

interface KryomCommand {
  id: string
  payload?: { path?: string; nonce?: number }
}

interface KryomGitRemote {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

interface KryomVerifyResult {
  ok: boolean
  kind: 'github' | 'local'
  url: string
  refs: string[]
}

interface KryomCloneResult {
  root: string
  tree: KryomNode[]
  path: string
}

interface KryomPullResult {
  success: boolean
  remote: string
  branch: string
  summary: string
}

interface KryomDocxExport {
  path: string
  bytes: number
}

interface KryomDocxImport {
  text: string
  truncated: boolean
  fileName: string
}

interface KryomAPI {
  platform: string

  versions: {
    electron: string
    chrome: string
    node: string
  }

  openWorkspace: () => Promise<KryomWorkspace | null>

  openFile: () => Promise<KryomOpenFileResult | null>

  openPath: (dirPath: string) => Promise<KryomWorkspace>

  readFile: (filePath: string) => Promise<string>

  saveFile: (
    filePath: string,
    content: string,
  ) => Promise<{ success: boolean }>

  runCommand: (command: string) => Promise<KryomTerminalResult>

  askAI: (payload: {
    prompt: string
    context?: string
    history?: KryomAIMessage[]
    model?: string
    researchSessionId?: string
  }) => Promise<KryomAIResponse>

  cancelAI: () => Promise<{ cancelled: boolean }>

  saveChat: (messages: KryomAIMessage[]) => Promise<{ saved: boolean }>

  restoreChat: () => Promise<{ messages: KryomAIMessage[]; restored: boolean }>

  closeWorkspace: () => Promise<{ success: boolean }>

  refreshWorkspace: () => Promise<KryomWorkspace>

  readFileMeta: (filePath: string) => Promise<KryomFileMeta>

  saveFileConditional: (
    filePath: string,
    content: string,
    expectedMtimeMs?: number | null,
  ) => Promise<{ success: boolean; mtimeMs: number }>

  saveAs: (
    content: string,
    suggestedName?: string,
  ) => Promise<KryomSaveAsResult | null>

  createPath: (payload: {
    path: string
    type: 'file' | 'directory'
    content?: string
  }) => Promise<{ success: boolean; path: string }>

  renamePath: (payload: {
    oldPath: string
    newPath: string
  }) => Promise<{ success: boolean; path: string }>

  deletePath: (targetPath: string) => Promise<{ success: boolean }>

  searchFiles: (payload: {
    query: string
    mode?: 'name' | 'content'
  }) => Promise<KryomSearchResult>

  cancelCommand: () => Promise<{ killed: number }>

  getTerminalStatus: () => Promise<{ running: KryomRunningProcess[] }>

  planAgentTask: (payload: {
    task: string
    model?: string
    contextPaths?: string[]
    researchSessionId?: string
  }) => Promise<KryomAgentPlan>

  cancelAgentPlan: () => Promise<{ cancelled: boolean }>

  applyAgentEdits: (payload: {
    edits: KryomAgentEdit[]
  }) => Promise<KryomAgentApplyResult>

  getAgentContext: (payload: {
    paths: string[]
  }) => Promise<KryomAgentContextPreview>

  gitStatus: () => Promise<KryomGitStatus>

  gitDiff: (payload?: {
    staged?: boolean
    path?: string
  }) => Promise<KryomGitDiff>

  gitChangedFiles: (payload?: {
    staged?: boolean
  }) => Promise<{ files: string[]; staged: boolean }>

  gitStage: (paths: string[]) => Promise<{ success: boolean; staged: number }>

  gitUnstage: (paths: string[]) => Promise<{ success: boolean; unstaged: number }>

  gitDiscard: (paths: string[]) => Promise<{ success: boolean; discarded: number }>

  gitCommit: (payload: {
    message: string
  }) => Promise<{ success: boolean }>

  gitPush: (payload?: {
    remote?: string
    branch?: string
  }) => Promise<{ success: boolean; remote: string; branch: string }>

  gitPull: (payload?: {
    remote?: string
    branch?: string
  }) => Promise<KryomPullResult>

  gitRemotes: () => Promise<{ remotes: KryomGitRemote[] }>

  gitVerify: (payload: {
    url: string
  }) => Promise<KryomVerifyResult>

  gitClone: (payload: {
    url: string
    name?: string
  }) => Promise<KryomCloneResult | null>

  exportBriefDocx: (payload: {
    sessionId: string
    template: string
  }) => Promise<KryomDocxExport | null>

  exportTextDocx: (payload: {
    title: string
    markdown: string
    template: string
  }) => Promise<KryomDocxExport | null>

  importDocx: () => Promise<KryomDocxImport | null>

  runDiagnostics: (payload: {
    command: string
  }) => Promise<KryomDiagnosticsResult>

  getWorkspaceSummary: () => Promise<KryomWorkspaceSummary>

  getWorkspaceContext: (payload?: {
    maxChars?: number
  }) => Promise<KryomWorkspaceContext>

  getSettings: () => Promise<KryomSettings>

  updateSettings: (patch: Partial<KryomSettings>) => Promise<KryomSettings>

  startResearch: (payload: {
    objective: string
  }) => Promise<{ id: string; status: string }>

  getResearchStatus: (payload: {
    id: string
  }) => Promise<KryomResearchSession>

  getActiveResearch: () => Promise<KryomResearchSession | null>

  listResearch: () => Promise<KryomResearchSummary[]>

  getResearch: (payload: {
    id: string
  }) => Promise<KryomResearchSession>

  getResearchBrief: (payload: {
    id: string
  }) => Promise<{ id: string; markdown: string }>

  cancelResearch: (payload: {
    id: string
  }) => Promise<KryomResearchSession>

  resumeResearch: (payload: {
    id: string
  }) => Promise<{ id: string; status: string }>

  selectResearch: (payload: {
    id: string
  }) => Promise<{ id: string }>

  getAppVersion: () => Promise<KryomAppVersion>

  openExternal: (url: string) => Promise<{ success: boolean }>

  getAIStatus: () => Promise<KryomAIStatus>

  getUIState: () => Promise<KryomUIState>

  setUIState: (patch: {
    autoSave?: boolean
    clearRecent?: boolean
  }) => Promise<KryomUIState>

  pushUIContext: (ctx: {
    hasWorkspace: boolean
    hasEditor: boolean
    terminalRunning?: boolean
    dirtyCount?: number
    title?: string
    saveAllNonce?: number
  }) => Promise<{ success: boolean }>

  onCommand: (handler: (command: KryomCommand) => void) => () => void

  onUIState: (handler: (state: KryomUIState) => void) => () => void
}

interface Window {
  kryom: KryomAPI
}
