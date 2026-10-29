import { useCallback, useEffect, useRef, useState } from 'react'
import { kryom, errorMessage, isWriteConflict } from '../api/kryom'
import { baseName, joinName, parentDir } from '../utils/paths'
import { detectLanguage } from '../utils/languages'
import { logOutput } from '../utils/output-log'
import {
  dirtyTabs,
  findTab,
  isDirty,
  nextActivePath,
  openTab,
  removeTabs,
  repathTabs,
  tabsUnder,
  updateTab,
  type TabState,
} from '../utils/tabs'
import { DialogProvider, useDialogs } from '../components/dialogs'
import { TitleBar, StatusBar } from '../components/Chrome'
import { ActivityBar, type ActivityId } from '../components/ActivityBar'
import { ResizeHandle } from '../components/ResizeHandle'
import { Explorer } from '../components/Explorer'
import { SearchPanel } from '../components/SearchPanel'
import { EditorPanel, type EditorApi } from '../components/EditorPanel'
import { AiChat } from '../components/AiChat'
import { AgentPanel } from '../components/AgentPanel'
import { ResearchPanel } from '../components/ResearchPanel'
import {
  TerminalPanelView,
  useTerminalController,
} from '../components/TerminalPanel'
import { ProblemsPanel } from '../components/ProblemsPanel'
import { GitPanel } from '../components/GitPanel'
import { SettingsModal } from '../components/SettingsModal'
import { WelcomePage } from '../components/WelcomePage'
import { ConnectionsPanel } from '../components/ConnectionsPanel'
import { ExtensionsPanel } from '../components/ExtensionsPanel'
import { ProfilePanel } from '../components/ProfilePanel'
import { OutputPanel } from '../components/OutputPanel'
import { AboutDialog } from '../components/AboutDialog'
import { QuickOpen } from '../components/QuickOpen'
import { ShortcutsDialog } from '../components/ShortcutsDialog'

type BottomTab = 'terminal' | 'problems' | 'git' | 'output'
type CenterView = 'editor' | 'home' | 'chat' | 'agent' | 'research'
type StageMode = 'chat' | 'agent' | 'research'

// Fixed homes, single-mounted: Git and Problems live in the sidebar,
// Chat/Agent/Research live on the center stage, Terminal and Output
// live in the right panel. Regions hide with `hidden` instead of
// unmounting, so conversations, plans, and research survive every
// navigation move without portal machinery.
const FALLBACK_SETTINGS: KryomSettings = {
  defaultModel: 'muse-spark-1.3',
  aiContextEnabled: true,
  panelLeftWidth: 260,
  panelRightWidth: 360,
  panelBottomHeight: 264,
}

const PANEL_LIMITS = {
  left: { min: 180, max: 420, fallback: 260 },
  bottom: { min: 120, max: 600, fallback: 264 },
} as const

const FONT_LIMITS = { min: 10, max: 24, fallback: 14 } as const

function clampLeftWidth(value: number): number {
  const max = Math.max(
    PANEL_LIMITS.left.min,
    Math.min(PANEL_LIMITS.left.max, window.innerWidth - 284)
  )

  return Math.min(max, Math.max(PANEL_LIMITS.left.min, Math.round(value)))
}

function clampBottomHeight(value: number): number {
  const max = Math.max(
    PANEL_LIMITS.bottom.min,
    Math.min(PANEL_LIMITS.bottom.max, window.innerHeight - 284)
  )

  return Math.min(max, Math.max(PANEL_LIMITS.bottom.min, Math.round(value)))
}

function clampFontSize(value: number): number {
  return Math.min(
    FONT_LIMITS.max,
    Math.max(FONT_LIMITS.min, Math.round(value))
  )
}

function readLocalActivity(): ActivityId {
  const raw = window.localStorage.getItem('kryom.activity')

  // Only sidebar-backed views persist here. Panel-backed
  // destinations (git, run, home) open the bottom panel or center
  // view instead, so a stale stored value falls back to Explorer.
  if (
    raw === 'explorer' ||
    raw === 'search' ||
    raw === 'extensions' ||
    raw === 'connections' ||
    raw === 'profile'
  ) {
    return raw
  }

  return 'explorer'
}

function readLocalFontSize(): number {
  const raw = Number(window.localStorage.getItem('kryom.editorFontSize'))

  if (Number.isFinite(raw)) {
    return clampFontSize(raw)
  }

  return FONT_LIMITS.fallback
}

function AppShell() {
  const dialogs = useDialogs()
  const [workspace, setWorkspace] = useState<KryomWorkspace | null>(null)
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  const [settings, setSettings] = useState<KryomSettings>(FALLBACK_SETTINGS)
  const [leftWidth, setLeftWidth] = useState(FALLBACK_SETTINGS.panelLeftWidth)
  const [bottomHeight, setBottomHeight] = useState(
    FALLBACK_SETTINGS.panelBottomHeight
  )
  const panelsRef = useRef({
    left: FALLBACK_SETTINGS.panelLeftWidth,
    bottom: FALLBACK_SETTINGS.panelBottomHeight,
  })
  const [summary, setSummary] = useState<KryomWorkspaceSummary | null>(null)
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')
  const [activity, setActivity] = useState<ActivityId>(() =>
    readLocalActivity()
  )
  const [sidebarVisible, setSidebarVisible] = useState(
    () => window.localStorage.getItem('kryom.sidebarVisible') !== '0'
  )
  const [centerView, setCenterView] = useState<CenterView>('home')
  const [fontSize, setFontSize] = useState(() => readLocalFontSize())
  const [cursor, setCursor] = useState<{ line: number; column: number }>({
    line: 1,
    column: 1,
  })
  const [gitBranch, setGitBranch] = useState<{
    known: boolean
    branch: string | null
  }>({ known: false, branch: null })
  const [autoSave, setAutoSave] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [diagSummary, setDiagSummary] = useState<{
    count: number
    success: boolean
  } | null>(null)
  const [diagnostics, setDiagnostics] = useState<KryomDiagnostic[]>([])
  const [diagnosticsRun, setDiagnosticsRun] = useState<{
    nonce: number
  } | null>(null)
  const runNonce = useRef(0)
  // Live mirrors: tabsRef keeps async flows (save-all) on fresh state,
  // saveInflight coalesces concurrent saves of the same tab (e.g. a
  // Monaco keybinding plus the matching native-menu accelerator).
  const tabsRef = useRef<TabState[]>([])
  tabsRef.current = tabs
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activePath
  const saveInflight = useRef(new Map<string, Promise<boolean>>())

  // Status and error reporters double as Output log writers so the
  // Output tab shows real milestones without touching every panel.
  const reportStatus = useCallback((message: string) => {
    setStatus(message)
    logOutput('app', message)
  }, [])

  const reportError = useCallback((e: unknown) => {
    const message = errorMessage(e)

    setError(message)
    logOutput('error', message)
  }, [])

  const terminal = useTerminalController(
    workspace?.root ?? null,
    reportStatus
  )
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal')
  const [bottomOpen, setBottomOpen] = useState(
    () => window.localStorage.getItem('kryom.bottomOpen') !== '0'
  )
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [welcomeChatPrompt, setWelcomeChatPrompt] = useState<{
    text: string
    nonce: number
  } | null>(null)
  const [welcomeAgentTask, setWelcomeAgentTask] = useState<{
    text: string
    nonce: number
    researchSessionId?: string
  } | null>(null)
  const [welcomeResearchStart, setWelcomeResearchStart] = useState<{
    objective: string
    nonce: number
  } | null>(null)
  const [chatResearchId, setChatResearchId] = useState<string | null>(null)
  const welcomeNonce = useRef(0)
  const editorApi = useRef<EditorApi | null>(null)

  // Navigation history over opened files for Go Back/Forward.
  const historyRef = useRef<{ entries: string[]; index: number }>({
    entries: [],
    index: -1,
  })
  const navigatingRef = useRef(false)

  const activeTab = activePath ? findTab(tabs, activePath) : null
  const dirty = activeTab !== null && isDirty(activeTab)
  const dirtyCount = dirtyTabs(tabs).length
  const windowTitle = `${dirty ? '• ' : ''}${activeTab ? `${baseName(activeTab.path)} — ` : ''}${workspace ? `${baseName(workspace.root)} — ` : ''}KryomCode`
  const showEditor = centerView === 'editor' && activeTab !== null
  const staged: StageMode | null =
    centerView === 'chat' || centerView === 'agent' || centerView === 'research'
      ? centerView
      : null

  useEffect(() => {
    logOutput('app', 'KryomCode started')

    // Retired layout keys from earlier shells.
    window.localStorage.removeItem('kryom.panelLoc')
    window.localStorage.removeItem('kryom.rightOpen')

    kryom()
      .getSettings()
      .then((loaded) => {
        setSettings(loaded)

        const left = clampLeftWidth(loaded.panelLeftWidth)
        const bottom = clampBottomHeight(loaded.panelBottomHeight)

        panelsRef.current = { left, bottom }
        setLeftWidth(left)
        setBottomHeight(bottom)
      })
      .catch(() => undefined)

    kryom()
      .getUIState()
      .then((state) => {
        setAutoSave(state.autoSave)
        setRecent(state.recent)
      })
      .catch(() => undefined)

    return kryom().onUIState((state) => {
      setAutoSave(state.autoSave)
      setRecent(state.recent)
    })
  }, [])

  useEffect(() => {
    window.localStorage.setItem('kryom.activity', activity)
  }, [activity])

  useEffect(() => {
    window.localStorage.setItem('kryom.sidebarVisible', sidebarVisible ? '1' : '0')
  }, [sidebarVisible])

  useEffect(() => {
    window.localStorage.setItem('kryom.bottomOpen', bottomOpen ? '1' : '0')
  }, [bottomOpen])

  useEffect(() => {
    window.localStorage.setItem('kryom.editorFontSize', String(fontSize))
  }, [fontSize])

  // Keep the layout valid when the Electron window itself is resized.
  useEffect(() => {
    const onWindowResize = () => {
      const left = clampLeftWidth(panelsRef.current.left)
      const bottom = clampBottomHeight(panelsRef.current.bottom)

      panelsRef.current = { left, bottom }
      setLeftWidth(left)
      setBottomHeight(bottom)
    }

    window.addEventListener('resize', onWindowResize)

    return () => window.removeEventListener('resize', onWindowResize)
  }, [])

  const persistPanels = useCallback(() => {
    const panels = panelsRef.current

    kryom()
      .updateSettings({
        panelLeftWidth: panels.left,
        panelBottomHeight: panels.bottom,
      })
      .catch(() => undefined)
  }, [])

  const resizeLeft = useCallback((value: number) => {
    const next = clampLeftWidth(value)

    panelsRef.current.left = next
    setLeftWidth(next)
  }, [])

  const resizeBottom = useCallback((value: number) => {
    const next = clampBottomHeight(value)

    panelsRef.current.bottom = next
    setBottomHeight(next)
  }, [])

  function resetPanels() {
    const left = PANEL_LIMITS.left.fallback
    const bottom = PANEL_LIMITS.bottom.fallback

    panelsRef.current = { left, bottom }
    setLeftWidth(left)
    setBottomHeight(bottom)

    kryom()
      .updateSettings({ panelLeftWidth: left, panelBottomHeight: bottom })
      .then(() => reportStatus('Panel sizes reset to defaults'))
      .catch((e) => reportError(e))
  }

  useEffect(() => {
    if (!workspace) {
      setSummary(null)
      return
    }

    kryom()
      .getWorkspaceSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [workspace])

  const refreshGitBranch = useCallback(async () => {
    if (!workspace) {
      setGitBranch({ known: false, branch: null })
      return
    }

    try {
      const state = await kryom().gitStatus()

      setGitBranch({ known: true, branch: state.branch })
    } catch {
      setGitBranch({ known: false, branch: null })
    }
  }, [workspace])

  useEffect(() => {
    void refreshGitBranch()
  }, [refreshGitBranch])

  // Push coarse capability state so the native menu can enable and
  // disable workspace/editor/terminal commands accurately. The dirty
  // count also drives the main-process close guard, and the title
  // keeps the OS window label in sync with project/file context.
  useEffect(() => {
    kryom()
      .pushUIContext({
        hasWorkspace: workspace !== null,
        hasEditor: activeTab !== null,
        terminalRunning: terminal.running,
        dirtyCount,
        title: windowTitle,
      })
      .catch(() => undefined)
  }, [workspace, activeTab, terminal.running, dirtyCount, windowTitle])

  // Reload guard (Ctrl+R and friends). Window close takes the richer
  // main-process Save/Discard/Cancel path instead; the main process
  // destroys approved windows so this never double-prompts there.
  // Covers editor buffers only: chat and agent sessions are in-memory.
  useEffect(() => {
    if (dirtyCount === 0) {
      return
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', onBeforeUnload)

    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  // Track opened files for Go Back/Forward. History-driven activations
  // set the navigating flag so the effect does not re-record them.
  useEffect(() => {
    if (!activePath) {
      return
    }

    const history = historyRef.current

    if (navigatingRef.current) {
      navigatingRef.current = false
      return
    }

    if (history.entries[history.index] === activePath) {
      return
    }

    const entries = [...history.entries.slice(0, history.index + 1), activePath].slice(-100)

    historyRef.current = { entries, index: entries.length - 1 }
  }, [activePath])

  const confirmDiscardTabs = useCallback(async (): Promise<boolean> => {
    const dirty = dirtyTabs(tabs)

    if (dirty.length === 0) {
      return true
    }

    const names = dirty
      .slice(0, 3)
      .map((tab) => baseName(tab.path))
      .join(', ')
    const extra = dirty.length > 3 ? ` and ${dirty.length - 3} more` : ''

    return dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `${names}${extra} ${dirty.length === 1 ? 'has' : 'have'} unsaved edits that will be lost.`,
      confirmLabel: 'Discard changes',
      danger: true,
    })
  }, [dialogs, tabs])

  async function refreshExplorer() {
    if (!workspace || explorerLoading) {
      return
    }

    setExplorerLoading(true)

    try {
      setWorkspace(await kryom().refreshWorkspace())
    } catch (e) {
      reportError(e)
    } finally {
      setExplorerLoading(false)
    }
  }

  function resetForWorkspace(next: KryomWorkspace | null) {
    setWorkspace(next)
    setTabs([])
    setActivePath(null)
    setCenterView('home')
    setCursor({ line: 1, column: 1 })
    setDiagSummary(null)
    setDiagnostics([])
    historyRef.current = { entries: [], index: -1 }

    if (!next) {
      setSummary(null)
    }
  }

  async function openProject() {
    if (!(await confirmDiscardTabs())) {
      return
    }

    setError('')

    try {
      const result = await kryom().openWorkspace()

      if (result) {
        resetForWorkspace(result)
        setActivity('explorer')
        setSidebarVisible(true)
        reportStatus('Project opened')
      }
    } catch (e) {
      reportError(e)
    }
  }

  async function openSingleFile() {
    if (!(await confirmDiscardTabs())) {
      return
    }

    setError('')

    try {
      const result = await kryom().openFile()

      if (!result) {
        return
      }

      resetForWorkspace({ root: result.root, tree: result.tree })
      setActivity('explorer')
      setSidebarVisible(true)
      await openEditorFile(result.filePath)
      reportStatus('File opened')
    } catch (e) {
      reportError(e)
    }
  }

  async function openRecentPath(target: string) {
    if (!(await confirmDiscardTabs())) {
      return
    }

    setError('')

    try {
      const result = await kryom().openPath(target)

      resetForWorkspace(result)
      setActivity('explorer')
      setSidebarVisible(true)
      reportStatus('Project opened')
    } catch (e) {
      reportError(e)

      // A stale recent entry may have been pruned; re-read the list.
      kryom()
        .getUIState()
        .then((state) => setRecent(state.recent))
        .catch(() => undefined)
    }
  }

  async function clearRecent() {
    try {
      const state = await kryom().setUIState({ clearRecent: true })

      setRecent(state.recent)
      reportStatus('Recent projects cleared')
    } catch (e) {
      reportError(e)
    }
  }

  async function cloneRepository(url: string) {
    if (!(await confirmDiscardTabs())) {
      return
    }

    setError('')

    try {
      const result = await kryom().gitClone({ url })

      if (!result) {
        reportStatus('Clone cancelled')
        return
      }

      resetForWorkspace({ root: result.root, tree: result.tree })
      setActivity('explorer')
      setSidebarVisible(true)
      reportStatus('Repository cloned and opened')
    } catch (e) {
      reportError(e)
    }
  }

  // Creates base.ext, base-2.ext, ... until the backend accepts one.
  async function createUniqueFile(
    dir: string,
    base: string,
    ext: string,
    content: string
  ): Promise<string> {
    const safeBase =
      base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') ||
      'document'

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const name =
        attempt === 0
          ? `${safeBase}.${ext}`
          : `${safeBase}-${attempt + 1}.${ext}`

      try {
        const created = await kryom().createPath({
          path: joinName(dir, name),
          type: 'file',
          content,
        })

        return created.path
      } catch (e) {
        if (!/exists|EEXIST/i.test(errorMessage(e)) || attempt === 9) {
          throw e
        }
      }
    }

    throw new Error('Could not find a free file name.')
  }

  function reportScaffold(template: string): string {
    const date = new Date().toISOString().slice(0, 10)
    const technical = template === 'technical'

    return [
      `# Report — ${date}`,
      '',
      '## Objective',
      '',
      'What question does this report answer?',
      '',
      technical ? '## Design' : '## Findings',
      '',
      technical
        ? 'Architecture, components, and trade-offs.'
        : 'Key findings with evidence, one per bullet.',
      '',
      '- ',
      '',
      technical ? '## Verification' : '## Next steps',
      '',
      technical
        ? 'How was this tested? Commands and results.'
        : 'Follow-up actions and owners.',
      '',
      '## Sources',
      '',
      '1. ',
      '',
    ].join('\n')
  }

  async function createReport(template: string) {
    if (!workspace) {
      reportStatus('Open a project first')
      return
    }

    setError('')

    try {
      const created = await createUniqueFile(
        workspace.root,
        'report',
        'md',
        reportScaffold(template)
      )
      await refreshExplorer()
      await openEditorFile(created)
      reportStatus('Report created')
    } catch (e) {
      reportError(e)
    }
  }

  async function exportActiveFile(template: string) {
    if (!activeTab) {
      reportStatus('Open a file first')
      return
    }

    setError('')

    try {
      const title = baseName(activeTab.path).replace(/\.[^.]+$/, '') || 'document'
      const result = await kryom().exportTextDocx({
        title,
        markdown: activeTab.content,
        template,
      })

      if (!result) {
        reportStatus('Export cancelled')
        return
      }

      await refreshExplorer()
      reportStatus(`Exported ${baseName(result.path)}`)
    } catch (e) {
      reportError(e)
    }
  }

  async function importSave(text: string, fileName: string) {
    if (!workspace) {
      reportStatus('Open a project first')
      return
    }

    setError('')

    try {
      const base = fileName.replace(/\.docx$/i, '') || 'imported'
      const created = await createUniqueFile(workspace.root, base, 'md', text)

      await refreshExplorer()
      await openEditorFile(created)
      reportStatus('Imported document saved and opened')
    } catch (e) {
      reportError(e)
    }
  }

  async function closeProject() {
    if (!workspace || !(await confirmDiscardTabs())) {
      return
    }

    try {
      await kryom().closeWorkspace()
      resetForWorkspace(null)
      reportStatus('Project closed')
    } catch (e) {
      reportError(e)
    }
  }

  async function openEditorFile(targetPath: string, line?: number) {
    const existing = findTab(tabs, targetPath)

    if (existing) {
      setActivePath(existing.path)
      setCenterView('editor')

      if (line !== undefined) {
        setPendingLine(line)
      }

      return
    }

    setOpening(true)
    setError('')

    try {
      const meta = await kryom().readFileMeta(targetPath)

      setTabs((previous) =>
        openTab(previous, {
          path: meta.path,
          content: meta.content,
          savedContent: meta.content,
          mtimeMs: meta.mtimeMs,
        })
      )
      setActivePath(meta.path)
      setCenterView('editor')
      setCursor({ line: 1, column: 1 })

      if (line !== undefined) {
        setPendingLine(line)
      }

      reportStatus('File opened')
    } catch (e) {
      reportError(e)
    } finally {
      setOpening(false)
    }
  }

  function selectTab(targetPath: string) {
    if (findTab(tabs, targetPath)) {
      setActivePath(targetPath)
      setCenterView('editor')
      setCursor({ line: 1, column: 1 })
    }
  }

  // Ctrl+Tab / Ctrl+Shift+Tab cycle through open tabs in strip order.
  // No native accelerator is registered for these, so the window
  // keydown listener below is the single handler.
  const cycleTab = useCallback((delta: 1 | -1) => {
    const list = tabsRef.current

    if (list.length < 2) {
      return
    }

    const index = list.findIndex(
      (tab) => tab.path === activePathRef.current
    )
    const base = index < 0 ? (delta > 0 ? -1 : 0) : index
    const next = list[(base + delta + list.length) % list.length]

    setActivePath(next.path)
    setCenterView('editor')
    setCursor({ line: 1, column: 1 })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key !== 'Tab'
      ) {
        return
      }

      if (tabsRef.current.length < 2) {
        return
      }

      event.preventDefault()
      cycleTab(event.shiftKey ? -1 : 1)
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [cycleTab])

  function navigateHistory(delta: -1 | 1) {
    const history = historyRef.current
    const next = history.index + delta

    if (next < 0 || next >= history.entries.length) {
      reportStatus(
        delta < 0 ? 'No earlier file in history' : 'No later file in history'
      )
      return
    }

    navigatingRef.current = true
    historyRef.current = { entries: history.entries, index: next }

    const target = history.entries[next]

    if (findTab(tabs, target)) {
      setActivePath(target)
      setCenterView('editor')
    } else {
      void openEditorFile(target)
    }
  }

  async function reloadEditor(targetPath: string) {
    try {
      const meta = await kryom().readFileMeta(targetPath)

      setTabs((previous) =>
        updateTab(previous, meta.path, {
          path: meta.path,
          content: meta.content,
          savedContent: meta.content,
          mtimeMs: meta.mtimeMs,
        })
      )
      reportStatus('Reloaded from disk')
    } catch (e) {
      reportError(e)
    }
  }

  async function overwriteEditor(targetPath: string, content: string) {
    try {
      await kryom().saveFile(targetPath, content)
      const meta = await kryom().readFileMeta(targetPath)

      setTabs((previous) =>
        updateTab(previous, meta.path, {
          path: meta.path,
          content: meta.content,
          savedContent: meta.content,
          mtimeMs: meta.mtimeMs,
        })
      )
      reportStatus('All changes saved')
    } catch (e) {
      reportError(e)
    }
  }

  // Saves one tab by path. Returns true when the tab no longer holds
  // unsaved work (saved, reloaded after a conflict, or already clean).
  // Concurrent callers share one in-flight save per path, so a Monaco
  // keybinding plus its native-menu accelerator can never double-save.
  async function saveTab(targetPath: string): Promise<boolean> {
    const inflight = saveInflight.current.get(targetPath)

    if (inflight) {
      return inflight
    }

    const run = saveTabInner(targetPath)

    saveInflight.current.set(targetPath, run)

    try {
      return await run
    } finally {
      saveInflight.current.delete(targetPath)
    }
  }

  async function saveTabInner(targetPath: string): Promise<boolean> {
    const tab = findTab(tabs, targetPath)

    if (!tab || saving) {
      return false
    }

    if (!isDirty(tab)) {
      reportStatus('No changes to save')
      return true
    }

    const content = tab.content
    const expectedMtimeMs = tab.mtimeMs

    setSaving(true)
    setError('')

    try {
      const result = await kryom().saveFileConditional(
        targetPath,
        content,
        expectedMtimeMs
      )

      setTabs((previous) =>
        updateTab(previous, targetPath, {
          savedContent: content,
          mtimeMs: result.mtimeMs,
        })
      )
      reportStatus('All changes saved')

      return true
    } catch (e) {
      if (isWriteConflict(e)) {
        const choice = await dialogs.resolveConflict({
          fileName: baseName(targetPath),
        })

        if (choice === 'reload') {
          await reloadEditor(targetPath)

          return true
        }

        if (choice === 'overwrite') {
          await overwriteEditor(targetPath, content)

          return true
        }

        return false
      }

      reportError(e)

      return false
    } finally {
      setSaving(false)
    }
  }

  const saveTabRef = useRef(saveTab)
  saveTabRef.current = saveTab

  // Auto Save: persists the dirty active tab shortly after edits stop.
  // Conflict dialogs still apply; nothing is silently discarded.
  useEffect(() => {
    if (!autoSave || !activeTab || !isDirty(activeTab)) {
      return
    }

    const target = activeTab.path
    const timer = window.setTimeout(() => {
      void saveTabRef.current(target)
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [autoSave, activeTab])

  async function saveEditor() {
    if (activePath) {
      await saveTab(activePath)
    }
  }

  // Sequential save-all for the main-process close guard. Conflict
  // dialogs surface per tab; a cancel or failure keeps that tab dirty
  // and the reported count aborts the close. The nonce echo lets the
  // main process settle promptly instead of waiting out its deadline.
  async function saveAllTabs(nonce: number) {
    const snapshot = dirtyTabs(tabsRef.current)
    let failed = 0

    for (const tab of snapshot) {
      const settled = await saveTabRef.current(tab.path)

      if (!settled) {
        failed += 1
      }
    }

    // Let React flush the tab updates, then report the live count so
    // buffers dirtied mid-save still block the close. Fail-safe: any
    // doubt reports dirty and the close is retried, never forced.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const count = Math.max(dirtyTabs(tabsRef.current).length, failed)

    kryom()
      .pushUIContext({
        hasWorkspace: workspace !== null,
        hasEditor: activePath !== null,
        terminalRunning: terminal.running,
        dirtyCount: count,
        title: windowTitle,
        saveAllNonce: nonce,
      })
      .catch(() => undefined)
  }

  async function saveAs() {
    if (!activeTab) {
      return
    }

    setError('')

    try {
      const result = await kryom().saveAs(
        activeTab.content,
        baseName(activeTab.path)
      )

      if (!result) {
        reportStatus('Save As cancelled')
        return
      }

      if (result.path === activeTab.path) {
        setTabs((previous) =>
          updateTab(previous, result.path, {
            savedContent: result.content,
            mtimeMs: result.mtimeMs,
          })
        )
      } else {
        const oldPath = activeTab.path

        setTabs((previous) =>
          openTab(removeTabs(previous, [oldPath]), {
            path: result.path,
            content: result.content,
            savedContent: result.content,
            mtimeMs: result.mtimeMs,
          })
        )
        setActivePath(result.path)
      }

      await refreshExplorer()
      reportStatus('File saved')
    } catch (e) {
      reportError(e)
    }
  }

  async function toggleAutoSave() {
    try {
      const state = await kryom().setUIState({ autoSave: !autoSave })

      setAutoSave(state.autoSave)
      reportStatus(state.autoSave ? 'Auto Save on' : 'Auto Save off')
    } catch (e) {
      reportError(e)
    }
  }

  async function newFile() {
    if (!workspace) {
      reportStatus('Open a project first')
      return
    }

    const name = await dialogs.prompt({
      title: 'New file',
      label: 'Name',
      placeholder: 'example.ts',
      confirmLabel: 'Create',
    })

    if (!name) {
      return
    }

    try {
      const created = await kryom().createPath({
        path: joinName(workspace.root, name),
        type: 'file',
      })
      await refreshExplorer()
      reportStatus('File created')
      await openEditorFile(created.path)
    } catch (e) {
      reportError(e)
    }
  }

  function dropTabs(paths: string[]) {
    setTabs((previous) => {
      const next = removeTabs(previous, paths)

      if (activePath && !next.some((tab) => tab.path === activePath)) {
        setActivePath(next.length > 0 ? next[0].path : null)
      }

      return next
    })
  }

  async function closeTab(targetPath: string) {
    const tab = findTab(tabs, targetPath)

    if (!tab) {
      return
    }

    if (isDirty(tab)) {
      const choice = await dialogs.confirmCloseDirty({
        fileName: baseName(tab.path),
      })

      if (choice === 'cancel') {
        return
      }

      if (choice === 'save') {
        const saved = await saveTab(tab.path)

        if (!saved) {
          return
        }
      }
    }

    const next = nextActivePath(tabs, targetPath, activePath)

    setTabs((previous) => removeTabs(previous, [targetPath]))
    setActivePath(next)

    if (!next) {
      setCenterView('home')
    }

    reportStatus('Tab closed')
  }

  async function closeOtherTabs(keepPath: string) {
    const others = tabs.filter((tab) => tab.path !== keepPath)
    const dirtyOthers = others.filter(isDirty)

    if (dirtyOthers.length > 0) {
      const confirmed = await dialogs.confirm({
        title: 'Discard unsaved changes?',
        message:
          `${dirtyOthers.length} other tab${dirtyOthers.length === 1 ? ' has' : 's have'} ` +
          'unsaved edits that will be lost.',
        confirmLabel: 'Discard changes',
        danger: true,
      })

      if (!confirmed) {
        return
      }
    }

    setTabs((previous) => previous.filter((tab) => tab.path === keepPath))
    setActivePath(keepPath)
    reportStatus('Other tabs closed')
  }

  async function createEntry(dir: string, type: 'file' | 'directory') {
    const name = await dialogs.prompt({
      title: type === 'file' ? 'New file' : 'New folder',
      label: 'Name',
      placeholder: type === 'file' ? 'example.ts' : 'components',
      confirmLabel: 'Create',
    })

    if (!name) {
      return
    }

    try {
      const created = await kryom().createPath({
        path: joinName(dir, name),
        type,
      })
      await refreshExplorer()
      reportStatus(type === 'file' ? 'File created' : 'Folder created')

      if (type === 'file') {
        await openEditorFile(created.path)
      }
    } catch (e) {
      reportError(e)
    }
  }

  async function renameEntry(node: KryomNode) {
    const name = await dialogs.prompt({
      title: `Rename ${node.type}`,
      label: 'New name',
      initialValue: baseName(node.path),
      confirmLabel: 'Rename',
    })

    if (!name) {
      return
    }

    const oldPath = node.path
    const newPath = joinName(parentDir(oldPath), name)

    try {
      await kryom().renamePath({ oldPath, newPath })

      setTabs((previous) => repathTabs(previous, oldPath, newPath))
      setActivePath((previous) => {
        if (!previous) {
          return previous
        }

        if (previous === oldPath) {
          return newPath
        }

        if (
          previous.startsWith(`${oldPath}/`) ||
          previous.startsWith(`${oldPath}\\`)
        ) {
          return newPath + previous.slice(oldPath.length)
        }

        return previous
      })

      await refreshExplorer()
      reportStatus('Renamed')
    } catch (e) {
      reportError(e)
    }
  }

  async function deleteEntry(node: KryomNode) {
    const affected = tabsUnder(tabs, node.path)
    const dirtyAffected = affected.filter(isDirty)
    const confirmed = await dialogs.confirm({
      title: `Delete ${node.type}?`,
      message:
        `"${baseName(node.path)}" will be permanently deleted.` +
        (dirtyAffected.length > 0
          ? ` ${dirtyAffected.length} open tab${dirtyAffected.length === 1 ? ' has' : 's have'} unsaved changes that will be lost.`
          : ''),
      confirmLabel: 'Delete',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    try {
      await kryom().deletePath(node.path)

      if (affected.length > 0) {
        dropTabs(affected.map((tab) => tab.path))
      }

      await refreshExplorer()
      reportStatus('Deleted')
    } catch (e) {
      reportError(e)
    }
  }

  async function handleAgentFilesChanged(changedPaths: string[]) {
    await refreshExplorer()

    let warned = false

    for (const changed of changedPaths) {
      const tab = findTab(tabs, changed)

      if (!tab) {
        continue
      }

      if (isDirty(tab)) {
        warned = true
        continue
      }

      await reloadEditor(tab.path)
    }

    if (warned) {
      reportStatus(
        'Agent changed an open file with unsaved edits. Save to review the disk conflict.'
      )
    }
  }

  function showBottom(tab: BottomTab) {
    setBottomTab(tab)
    setBottomOpen(true)
  }

  function toggleBottom(tab: BottomTab) {
    if (bottomTab === tab && bottomOpen) {
      setBottomOpen(false)
      return
    }

    showBottom(tab)
  }

  function selectActivity(id: ActivityId) {
    // Panel-backed destinations never take over the sidebar: Source
    // Control and Run toggle bottom-panel tabs, AI Workspace centers
    // the welcome/stage view. The sidebar keeps its own selection.
    if (id === 'git') {
      toggleBottom('git')
      void refreshGitBranch()
      return
    }

    if (id === 'run') {
      toggleBottom('problems')
      return
    }

    if (id === 'home') {
      setCenterView('home')
      return
    }

    // Re-selecting the visible view collapses the sidebar, VS Code style.
    if (id === activity && sidebarVisible) {
      setSidebarVisible(false)
      return
    }

    setActivity(id)
    setSidebarVisible(true)
  }

  function showSidebar(id: ActivityId) {
    if (id === 'git') {
      showBottom('git')
      void refreshGitBranch()
      return
    }

    if (id === 'run') {
      showBottom('problems')
      return
    }

    if (id === 'home') {
      setCenterView('home')
      return
    }

    setActivity(id)
    setSidebarVisible(true)
  }

  // Activity-bar active state: panel-backed destinations reflect the
  // bottom panel and center view; sidebar views reflect the sidebar.
  function isActivitySelected(id: ActivityId): boolean {
    if (id === 'home') {
      return centerView !== 'editor'
    }

    if (id === 'git') {
      return bottomOpen && bottomTab === 'git'
    }

    if (id === 'run') {
      return bottomOpen && bottomTab === 'problems'
    }

    return activity === id && sidebarVisible
  }

  function showHome() {
    setCenterView('home')
  }

  function stageCenter(mode: StageMode) {
    setCenterView(mode)
  }

  function unstageCenter() {
    setCenterView(tabs.length > 0 ? 'editor' : 'home')
  }

  function handleWelcomeChat(prompt: string) {
    welcomeNonce.current += 1
    setWelcomeChatPrompt({ text: prompt, nonce: welcomeNonce.current })
    stageCenter('chat')
    reportStatus('AI request sent from welcome')
  }

  function handleWelcomeAgent(task: string) {
    welcomeNonce.current += 1
    setWelcomeAgentTask({ text: task, nonce: welcomeNonce.current })
    stageCenter('agent')
    reportStatus('Agent task started — review the plan before applying')
  }

  function handleWelcomeResearch(objective: string) {
    welcomeNonce.current += 1
    setWelcomeResearchStart({ objective, nonce: welcomeNonce.current })
    stageCenter('research')
    reportStatus('Research started from welcome')
  }

  function handleResearchImplement(session: KryomResearchSession) {
    welcomeNonce.current += 1
    setWelcomeAgentTask({
      text:
        `Implement from research brief (session ${session.id}).\n` +
        `Objective: ${session.objective}\n` +
        'Follow the brief\'s ordered implementation tasks and acceptance criteria. ' +
        'Cite the brief\'s sources when reporting which requirements are satisfied.',
      nonce: welcomeNonce.current,
      researchSessionId: session.id,
    })
    stageCenter('agent')
    reportStatus('Agent planning from research brief…')
  }

  function handleResearchAsk(session: KryomResearchSession) {
    setChatResearchId(session.id)
    stageCenter('chat')
    reportStatus(`AI chat attached to research ${session.id}`)
  }

  function runDiagnosticsNow() {
    if (!workspace) {
      reportStatus('Open a project first')
      return
    }

    showBottom('problems')
    runNonce.current += 1
    setDiagnosticsRun({ nonce: runNonce.current })
    reportStatus('Diagnostics running…')
  }

  async function goToLine() {
    if (!activeTab) {
      reportStatus('Open a file first')
      return
    }

    const answer = await dialogs.prompt({
      title: 'Go to Line',
      label: 'Line number',
      placeholder: '1',
      confirmLabel: 'Go',
    })

    if (!answer) {
      return
    }

    const line = Number.parseInt(answer, 10)

    if (!Number.isFinite(line) || line < 1) {
      reportStatus('Invalid line number')
      return
    }

    setCenterView('editor')
    setPendingLine(line)
  }

  function openQuickOpen() {
    if (!workspace) {
      reportStatus('Open a project first')
      return
    }

    setQuickOpen(true)
  }

  function changeFontSize(delta: number) {
    setFontSize((previous) => {
      const next = clampFontSize(previous + delta)

      if (next !== previous) {
        reportStatus(`Editor font size ${next}px`)
      }

      return next
    })
  }

  // Native-menu command dispatcher. Every command reuses the same
  // handlers as the in-app controls, including confirmations.
  const handleCommand = useCallback(
    (command: KryomCommand) => {
      logOutput('menu', `Command: ${command.id}`)

      switch (command.id) {
        case 'file.newFile':
          void newFile()
          break
        case 'file.openFile':
          void openSingleFile()
          break
        case 'file.openFolder':
          void openProject()
          break
        case 'file.openPath':
          if (command.payload?.path) {
            void openRecentPath(command.payload.path)
          }
          break
        case 'file.save':
          void saveEditor()
          break
        case 'file.saveAs':
          void saveAs()
          break
        case 'file.saveAll':
          void saveAllTabs(command.payload?.nonce ?? 0)
          break
        case 'file.toggleAutoSave':
          void toggleAutoSave()
          break
        case 'file.closeEditor':
          if (activePath) {
            void closeTab(activePath)
          }
          break
        case 'file.closeFolder':
          void closeProject()
          break
        case 'edit.find':
          if (editorApi.current && activeTab) {
            setCenterView('editor')
            editorApi.current.find()
          } else {
            reportStatus('Open a file to use Find')
          }
          break
        case 'edit.replace':
          if (editorApi.current && activeTab) {
            setCenterView('editor')
            editorApi.current.replace()
          } else {
            reportStatus('Open a file to use Replace')
          }
          break
        case 'select.expand':
          if (editorApi.current && activeTab) {
            editorApi.current.expandSelection()
          } else {
            reportStatus('Open a file to change the selection')
          }
          break
        case 'select.shrink':
          if (editorApi.current && activeTab) {
            editorApi.current.shrinkSelection()
          } else {
            reportStatus('Open a file to change the selection')
          }
          break
        case 'view.explorer':
          showSidebar('explorer')
          break
        case 'view.search':
          showSidebar('search')
          break
        case 'view.git':
          showSidebar('git')
          break
        case 'view.run':
          showSidebar('run')
          break
        case 'view.home':
          showHome()
          break
        case 'view.chat':
          stageCenter('chat')
          break
        case 'view.agent':
          stageCenter('agent')
          break
        case 'view.research':
          stageCenter('research')
          break
        case 'view.focusEditor':
          if (activeTab) {
            setCenterView('editor')
          } else {
            showHome()
          }
          break
        case 'view.terminal':
          toggleBottom('terminal')
          break
        case 'view.output':
          showBottom('output')
          break
        case 'view.toggleSidebar':
          setSidebarVisible((visible) => !visible)
          break
        case 'view.toggleRight':
          setBottomOpen((open) => !open)
          break
        case 'editor.fontLarger':
          changeFontSize(1)
          break
        case 'editor.fontSmaller':
          changeFontSize(-1)
          break
        case 'go.file':
          openQuickOpen()
          break
        case 'go.line':
          void goToLine()
          break
        case 'go.back':
          navigateHistory(-1)
          break
        case 'go.forward':
          navigateHistory(1)
          break
        case 'run.diagnostics':
          runDiagnosticsNow()
          break
        case 'terminal.cancel':
          terminal.cancel()
          break
        case 'terminal.clear':
          terminal.clear()
          showBottom('terminal')
          reportStatus('Terminal cleared')
          break
        case 'terminal.focus':
          showBottom('terminal')
          break
        case 'help.shortcuts':
          setShortcutsOpen(true)
          break
        default:
          reportStatus(`Unknown command: ${command.id}`)
          break
      }
    },
    // The dispatcher closes over the latest shell state via this
    // callback identity; the subscription below always calls through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tabs,
      activePath,
      activeTab,
      workspace,
      bottomTab,
      bottomOpen,
      autoSave,
      saving,
      dialogs,
      terminal,
    ]
  )

  const commandRef = useRef(handleCommand)
  commandRef.current = handleCommand

  useEffect(() => {
    return kryom().onCommand((command) => commandRef.current(command))
  }, [])

  const projectInfo = summary
    ? `${summary.projectType}${
        summary.frameworks.length > 0
          ? ` · ${summary.frameworks.join(', ')}`
          : ''
      }`
    : null

  const scripts = summary ? Object.keys(summary.scripts) : []

  const sidebarTitle: Record<ActivityId, string> = {
    explorer: 'EXPLORER',
    search: 'SEARCH',
    git: 'SOURCE CONTROL',
    run: 'RUN AND DIAGNOSTICS',
    extensions: '',
    connections: '',
    home: 'AI WORKSPACE',
    profile: '',
  }

  const STAGE_TABS: Array<{ id: StageMode; label: string }> = [
    { id: 'chat', label: 'CHAT' },
    { id: 'agent', label: 'AGENT' },
    { id: 'research', label: 'RESEARCH' },
  ]

  const BOTTOM_TABS: Array<{ id: BottomTab; label: string }> = [
    { id: 'terminal', label: 'TERMINAL' },
    { id: 'problems', label: 'PROBLEMS' },
    { id: 'git', label: 'SOURCE CONTROL' },
    { id: 'output', label: 'OUTPUT' },
  ]

  return (
    <main className="ide">
      <TitleBar
        workspaceRoot={workspace?.root ?? null}
        activeFile={showEditor ? (activeTab?.path ?? null) : null}
        dirty={dirty}
        autoSave={autoSave}
      />

      <div className="shell">
        <ActivityBar
          active={activity}
          sidebarVisible={sidebarVisible}
          onSelect={selectActivity}
          onOpenSettings={() => setSettingsOpen(true)}
          isSelected={isActivitySelected}
        />

        {/* Always mounted (hidden when collapsed) so Git and
            Problems state survives collapsing the sidebar. */}
        <aside hidden={!sidebarVisible} className="sidebar" style={{ width: leftWidth }}>
          {sidebarTitle[activity] && (
            <div className="side-header">
              <span className="side-title">{sidebarTitle[activity]}</span>
            </div>
          )}

              <div hidden={activity !== 'explorer'} className="tab-body">
                <Explorer
                  workspace={workspace}
                  activeFile={activePath}
                  loading={explorerLoading}
                  projectInfo={projectInfo}
                  onOpenFile={(node) => void openEditorFile(node.path)}
                  onOpenProject={() => void openProject()}
                  onRefresh={() => void refreshExplorer()}
                  onNewFile={(dir) => void createEntry(dir, 'file')}
                  onNewFolder={(dir) => void createEntry(dir, 'directory')}
                  onRename={(node) => void renameEntry(node)}
                  onDelete={(node) => void deleteEntry(node)}
                />
              </div>

              <div hidden={activity !== 'search'} className="tab-body">
                <SearchPanel
                  workspaceRoot={workspace?.root ?? null}
                  onOpenMatch={(path, line) => void openEditorFile(path, line)}
                />
              </div>

              <div hidden={activity !== 'extensions'} className="tab-body">
                <ExtensionsPanel
                  workspaceRoot={workspace?.root ?? null}
                  defaultModel={settings.defaultModel}
                  terminalRunning={terminal.running}
                />
              </div>

              <div hidden={activity !== 'connections'} className="tab-body">
                <ConnectionsPanel
                  workspaceRoot={workspace?.root ?? null}
                  defaultModel={settings.defaultModel}
                  activeFileName={activeTab ? baseName(activeTab.path) : ''}
                  activeFileContent={activeTab?.content ?? ''}
                  onStatus={reportStatus}
                  onOpenSourceControl={() => showBottom('git')}
                  onCloneRepository={(url) => void cloneRepository(url)}
                  onCreateReport={(template) => void createReport(template)}
                  onExportActiveFile={(template) => void exportActiveFile(template)}
                  onImportSave={(text, fileName) => void importSave(text, fileName)}
                />
              </div>

              <div hidden={activity !== 'profile'} className="tab-body">
                <ProfilePanel
                  workspaceRoot={workspace?.root ?? null}
                  defaultModel={settings.defaultModel}
                  summary={summary}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenAbout={() => setAboutOpen(true)}
                />
              </div>
        </aside>

        {sidebarVisible && (
          <ResizeHandle
            orientation="vertical"
            direction={1}
            label="Resize sidebar"
            value={leftWidth}
            min={PANEL_LIMITS.left.min}
            max={PANEL_LIMITS.left.max}
            onResize={resizeLeft}
            onResizeEnd={persistPanels}
          />
        )}

        <section className="center">
          {showEditor && activeTab && (
            <EditorPanel
              tabs={tabs}
              activeTabPath={activeTab.path}
              onSelectTab={selectTab}
              onCloseTab={(path) => void closeTab(path)}
              onCloseOthers={(path) => void closeOtherTabs(path)}
              filePath={activeTab.path}
              fileName={baseName(activeTab.path)}
              content={activeTab.content}
              dirty={dirty}
              saving={saving}
              pendingLine={pendingLine}
              onChange={(value) =>
                setTabs((previous) =>
                  updateTab(previous, activeTab.path, { content: value })
                )
              }
              onSave={() => void saveEditor()}
              onRevealConsumed={() => setPendingLine(null)}
              registerApi={(api) => {
                editorApi.current = api
              }}
              fontSize={fontSize}
              onCursorChange={(line, column) => setCursor({ line, column })}
              workspaceRoot={workspace?.root ?? null}
              markers={diagnostics}
            />
          )}

          {/* Always mounted (hidden unless staged) so the Chat, Agent,
              and Research sessions survive editor and home visits. */}
          <section hidden={!staged} className="editor-panel stage">
            <div className="stage-tabs" role="tablist" aria-label="AI workspace">
              {STAGE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={staged === tab.id}
                  className={
                    staged === tab.id ? 'panel-tab active' : 'panel-tab'
                  }
                  onClick={() => stageCenter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
              <span className="spacer" />
              <button
                className="panel-tab stage-close"
                onClick={unstageCenter}
                title="Back to editor or home"
                aria-label="Close AI stage"
              >
                ×
              </button>
            </div>

            <div className="stage-body">
              <div hidden={staged !== 'chat'} className="tab-body">
                <AiChat
                  workspaceRoot={workspace?.root ?? null}
                  activeFile={activeTab?.path ?? null}
                  fileName={activeTab ? baseName(activeTab.path) : ''}
                  fileContent={activeTab?.content ?? ''}
                  dirty={dirty}
                  defaultModel={settings.defaultModel}
                  contextEnabled={settings.aiContextEnabled}
                  onStatus={reportStatus}
                  pendingPrompt={welcomeChatPrompt}
                  researchSessionId={chatResearchId}
                  onDetachResearch={() => setChatResearchId(null)}
                  onOpenConnections={() => showSidebar('connections')}
                />
              </div>
              <div hidden={staged !== 'agent'} className="tab-body">
                <AgentPanel
                  workspaceRoot={workspace?.root ?? null}
                  defaultModel={settings.defaultModel}
                  defaultIncludeContext={settings.aiContextEnabled}
                  activeFile={activeTab?.path ?? null}
                  activeFileDirty={dirty}
                  onFilesChanged={(paths) => void handleAgentFilesChanged(paths)}
                  onStatus={reportStatus}
                  pendingTask={welcomeAgentTask}
                  onOpenConnections={() => showSidebar('connections')}
                  onOpenFile={(path) => void openEditorFile(path)}
                />
              </div>
              <div hidden={staged !== 'research'} className="tab-body">
                <ResearchPanel
                  workspaceRoot={workspace?.root ?? null}
                  onStatus={reportStatus}
                  onImplement={handleResearchImplement}
                  onAsk={handleResearchAsk}
                  pendingStart={welcomeResearchStart}
                />
              </div>
            </div>
          </section>

          {!showEditor && !staged && (
            <section className="editor-panel">
              {tabs.length > 0 && (
                <div className="tabbar home-tabbar">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => setCenterView('editor')}
                  >
                    ← Back to editor ({tabs.length} file{tabs.length === 1 ? '' : 's'} open)
                  </button>
                </div>
              )}
              <WelcomePage
                workspaceRoot={workspace?.root ?? null}
                defaultModel={settings.defaultModel}
                recent={recent}
                onOpenProject={() => void openProject()}
                onOpenRecent={(path) => void openRecentPath(path)}
                onClearRecent={() => void clearRecent()}
                onSubmitChat={handleWelcomeChat}
                onSubmitAgent={handleWelcomeAgent}
                onSubmitResearch={handleWelcomeResearch}
                onOpenConnections={() => showSidebar('connections')}
              />
            </section>
          )}

          {/* Bottom dock: single mounts for Terminal, Problems, Source
              Control, and Output. The sidebar no longer mounts Git or
              Problems; their activity-bar entries toggle these tabs. */}
          {bottomOpen && (
            <>
              <ResizeHandle
                orientation="horizontal"
                direction={-1}
                label="Resize bottom panel"
                value={bottomHeight}
                min={PANEL_LIMITS.bottom.min}
                max={PANEL_LIMITS.bottom.max}
                onResize={resizeBottom}
                onResizeEnd={persistPanels}
              />

              <aside
                className="bottom-panel"
                style={{ height: bottomHeight }}
                aria-label="Bottom panel"
              >
                <div
                  className="bottom-tabs"
                  role="tablist"
                  aria-label="Bottom panel"
                >
                  {BOTTOM_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={bottomTab === tab.id}
                      className={
                        bottomTab === tab.id
                          ? 'panel-tab active'
                          : 'panel-tab'
                      }
                      onClick={() => toggleBottom(tab.id)}
                      title={
                        bottomTab === tab.id
                          ? `Hide ${tab.label} (click again to collapse)`
                          : `Show ${tab.label}`
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                  <span className="spacer" />
                  <button
                    className="panel-tab bottom-collapse"
                    onClick={() => setBottomOpen(false)}
                    title="Close bottom panel (Ctrl+J toggles)"
                    aria-label="Close bottom panel"
                  >
                    ×
                  </button>
                </div>

                <div className="bottom-body">
                  <div hidden={bottomTab !== 'terminal'} className="tab-body">
                    <TerminalPanelView
                      controller={terminal}
                      workspaceRoot={workspace?.root ?? null}
                    />
                  </div>
                  <div hidden={bottomTab !== 'problems'} className="tab-body">
                    <ProblemsPanel
                      workspaceRoot={workspace?.root ?? null}
                      scripts={scripts}
                      onOpenFileAtLine={(path, line) =>
                        void openEditorFile(path, line)
                      }
                      onStatus={reportStatus}
                      pendingRun={diagnosticsRun}
                      onResult={(count, success) =>
                        setDiagSummary({ count, success })
                      }
                      onDiagnostics={(result) =>
                        setDiagnostics(result ? result.diagnostics : [])
                      }
                    />
                  </div>
                  <div hidden={bottomTab !== 'git'} className="tab-body">
                    <GitPanel
                      workspaceRoot={workspace?.root ?? null}
                      onStatus={reportStatus}
                    />
                  </div>
                  <div hidden={bottomTab !== 'output'} className="tab-body">
                    <OutputPanel />
                  </div>
                </div>
              </aside>
            </>
          )}
        </section>
      </div>

      <StatusBar
        status={status}
        workspaceName={workspace ? baseName(workspace.root) : null}
        branch={gitBranch.branch}
        branchKnown={gitBranch.known}
        onBranchRefresh={() => void refreshGitBranch()}
        fileName={activeTab ? baseName(activeTab.path) : null}
        dirty={dirty}
        language={activeTab ? detectLanguage(baseName(activeTab.path)) : null}
        line={showEditor ? cursor.line : null}
        column={showEditor ? cursor.column : null}
        model={settings.defaultModel}
        autoSave={autoSave}
        terminalRunning={terminal.running}
        diagnostics={diagSummary}
        onShowDiagnostics={() => showBottom('problems')}
        bottomOpen={bottomOpen}
        onToggleBottom={() => setBottomOpen((open) => !open)}
      />

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      <QuickOpen
        open={quickOpen}
        root={workspace?.root ?? ''}
        tree={workspace?.tree ?? []}
        onOpen={(path) => void openEditorFile(path)}
        onClose={() => setQuickOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        initial={settings}
        onClose={() => setSettingsOpen(false)}
        onSaved={(next) => {
          setSettings(next)
          reportStatus('Settings saved')
        }}
        fontSize={fontSize}
        onFontSizeChange={(size) => setFontSize(clampFontSize(size))}
        autoSave={autoSave}
        onToggleAutoSave={() => void toggleAutoSave()}
        panelLeftWidth={leftWidth}
        panelBottomHeight={bottomHeight}
        onResetPanels={resetPanels}
      />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </main>
  )
}

function App() {
  return (
    <DialogProvider>
      <AppShell />
    </DialogProvider>
  )
}

export default App
