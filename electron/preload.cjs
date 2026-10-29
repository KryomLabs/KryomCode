const { contextBridge, ipcRenderer } = require('electron')

// Minimal capability bridge: each method maps to one validated main
// process channel. No Node.js APIs, no file system, and no secrets are
// exposed to the renderer.

contextBridge.exposeInMainWorld('kryom', {
  platform: process.platform,

  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  openWorkspace: () => ipcRenderer.invoke('workspace:open'),

  openFile: () => ipcRenderer.invoke('workspace:open-file'),

  openPath: (dirPath) =>
    ipcRenderer.invoke('workspace:open-path', dirPath),

  closeWorkspace: () => ipcRenderer.invoke('workspace:close'),

  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),

  readFile: (filePath) =>
    ipcRenderer.invoke('workspace:read-file', filePath),

  saveFile: (filePath, content) =>
    ipcRenderer.invoke('workspace:save-file', filePath, content),

  readFileMeta: (filePath) =>
    ipcRenderer.invoke('filesystem:read-meta', filePath),

  saveFileConditional: (filePath, content, expectedMtimeMs) =>
    ipcRenderer.invoke(
      'filesystem:save-conditional',
      filePath,
      content,
      expectedMtimeMs
    ),

  saveAs: (content, suggestedName) =>
    ipcRenderer.invoke('filesystem:save-as', content, suggestedName),

  createPath: (payload) =>
    ipcRenderer.invoke('filesystem:create', payload),

  renamePath: (payload) =>
    ipcRenderer.invoke('filesystem:rename', payload),

  deletePath: (targetPath) =>
    ipcRenderer.invoke('filesystem:delete', targetPath),

  searchFiles: (payload) =>
    ipcRenderer.invoke('search:files', payload),

  runCommand: (command) =>
    ipcRenderer.invoke('terminal:run', command),

  cancelCommand: () =>
    ipcRenderer.invoke('terminal:cancel'),

  getTerminalStatus: () =>
    ipcRenderer.invoke('terminal:status'),

  askAI: (payload) =>
    ipcRenderer.invoke('ai:chat', payload),

  cancelAI: () =>
    ipcRenderer.invoke('ai:cancel'),

  saveChat: (messages) =>
    ipcRenderer.invoke('chat:save', { messages }),

  restoreChat: () =>
    ipcRenderer.invoke('chat:restore'),

  planAgentTask: (payload) =>
    ipcRenderer.invoke('agent:plan', payload),

  cancelAgentPlan: () =>
    ipcRenderer.invoke('agent:cancel'),

  applyAgentEdits: (payload) =>
    ipcRenderer.invoke('agent:apply', payload),

  getAgentContext: (payload) =>
    ipcRenderer.invoke('agent:context', payload),

  gitStatus: () =>
    ipcRenderer.invoke('git:status'),

  gitDiff: (payload) =>
    ipcRenderer.invoke('git:diff', payload),

  gitChangedFiles: (payload) =>
    ipcRenderer.invoke('git:changed-files', payload),

  gitStage: (paths) =>
    ipcRenderer.invoke('git:stage', paths),

  gitUnstage: (paths) =>
    ipcRenderer.invoke('git:unstage', paths),

  gitDiscard: (paths) =>
    ipcRenderer.invoke('git:discard', paths),

  gitCommit: (payload) =>
    ipcRenderer.invoke('git:commit', payload),

  gitPush: (payload) =>
    ipcRenderer.invoke('git:push', payload),

  gitPull: (payload) =>
    ipcRenderer.invoke('git:pull', payload),

  gitRemotes: () =>
    ipcRenderer.invoke('git:remotes'),

  gitVerify: (payload) =>
    ipcRenderer.invoke('git:verify', payload),

  gitClone: (payload) =>
    ipcRenderer.invoke('git:clone', payload),

  exportBriefDocx: (payload) =>
    ipcRenderer.invoke('documents:export-brief', payload),

  exportTextDocx: (payload) =>
    ipcRenderer.invoke('documents:export-text', payload),

  importDocx: () =>
    ipcRenderer.invoke('documents:import'),

  runDiagnostics: (payload) =>
    ipcRenderer.invoke('diagnostics:run', payload),

  getWorkspaceSummary: () =>
    ipcRenderer.invoke('intelligence:summary'),

  getWorkspaceContext: (payload) =>
    ipcRenderer.invoke('intelligence:context', payload),

  getSettings: () =>
    ipcRenderer.invoke('settings:get'),

  updateSettings: (patch) =>
    ipcRenderer.invoke('settings:update', patch),

  startResearch: (payload) =>
    ipcRenderer.invoke('research:start', payload),

  getResearchStatus: (payload) =>
    ipcRenderer.invoke('research:status', payload),

  getActiveResearch: () =>
    ipcRenderer.invoke('research:active'),

  listResearch: () =>
    ipcRenderer.invoke('research:list'),

  getResearch: (payload) =>
    ipcRenderer.invoke('research:get', payload),

  getResearchBrief: (payload) =>
    ipcRenderer.invoke('research:brief', payload),

  cancelResearch: (payload) =>
    ipcRenderer.invoke('research:cancel', payload),

  resumeResearch: (payload) =>
    ipcRenderer.invoke('research:resume', payload),

  selectResearch: (payload) =>
    ipcRenderer.invoke('research:select', payload),

  getAppVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  openExternal: (url) =>
    ipcRenderer.invoke('app:open-external', url),

  getAIStatus: () =>
    ipcRenderer.invoke('app:get-ai-status'),

  getUIState: () =>
    ipcRenderer.invoke('ui:get'),

  setUIState: (patch) =>
    ipcRenderer.invoke('ui:set', patch),

  pushUIContext: (ctx) =>
    ipcRenderer.invoke('ui:context', ctx),

  onCommand: (handler) => {
    const listener = (_event, command) => handler(command)

    ipcRenderer.on('kryom:command', listener)

    return () =>
      ipcRenderer.removeListener('kryom:command', listener)
  },

  onUIState: (handler) => {
    const listener = (_event, state) => handler(state)

    ipcRenderer.on('kryom:ui', listener)

    return () =>
      ipcRenderer.removeListener('kryom:ui', listener)
  },
})
