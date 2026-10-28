import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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

type BottomTab =
  | 'terminal'
  | 'problems'
  | 'output'
  | 'git'
  | 'ai'
  | 'agent'
  | 'research'
type CenterView = 'editor' | 'home' | 'chat' | 'agent' | 'research'
type StageMode = 'chat' | 'agent' | 'research'

// Dockable panels mount exactly once (state is never lost) and paint
// into whichever region currently owns them. Git and Problems live in
// the sidebar by default; Chat, Agent, and Research live on the center
// stage. Any of them can be moved to the bottom panel instead.
type DockableId = 'git' | 'problems' | 'ai' | 'agent' | 'research'
type DockableLoc = Record<DockableId, 'primary' | 'bottom'>

const DOCKABLE_IDS: DockableId[] = ['git', 'problems', 'ai', 'agent', 'research']

const FALLBACK_SETTINGS: KryomSettings = {
  defaultModel: 'muse-spark-1.3',
  aiContextEnabled: true,
  panelLeftWidth: 260,
  panelRightWidth: 360,
  panelBottomHeight: 264,
}

const PANEL_LIMITS = {
  left: { min: 180, max: 420, fallback: 260 },
  bottom: { min: 140, max: 640, fallback: 264 },
} as const

const FONT_LIMITS = { min: 10, max: 24, fallback: 14 } as const

// Detached overflow nodes: when a dockable panel's current host is not
// in the DOM (sidebar collapsed, stage showing something else), the
// portal paints here instead of unmounting, so session state survives.
const fallbackNodes: Record<string, HTMLElement> = {}

function fallbackNode(id: string): HTMLElement {
  if (!fallbackNodes[id]) {
    fallbackNodes[id] = document.createElement('div')
  }

  return fallbackNodes[id]
}

function Docked(props: {
  id: string
  primary: HTMLElement | null
  secondary: HTMLElement | null
  usePrimary: boolean
  children: ReactNode
}) {
  const node =
    (props.usePrimary ? props.primary : props.secondary) ??
    fallbackNode(props.id)

  return createPortal(props.children, node)
}

function DockPlaceholder(props: {
  title: string
  where: string
  actionLabel: string
  onBringHere: () => void
}) {
  return (
    <div className="dock-placeholder">
      <p className="muted">
        {props.title} is open in {props.where}.
      </p>
      <button
        type="button"
        className="secondary-button"
        onClick={props.onBringHere}
      >
        {props.actionLabel}
      </button>
    </div>
  )
}

function clampLeftWidth(value: number): number {
  const max = Math.max(
    PANEL_LIMITS.left.min,
    Math.min(PANEL_LIMITS.left.max, window.innerWidth - 284)
  )

  return Math.min(max, Math.max(PANEL_LIMITS.left.min, Math.round(value)))
}

function clampBottomHeight(value: number): number {
  const max = Math.max(
    200,
    Math.min(PANEL_LIMITS.bottom.max, window.innerHeight - 282)
  )

  return Math.min(
    max,
    Math.max(PANEL_LIMITS.bottom.min, Math.round(value))
  )
}

function clampFontSize(value: number): number {
  return Math.min(
    FONT_LIMITS.max,
    Math.max(FONT_LIMITS.min, Math.round(value))
  )
}

function readLocalActivity(): ActivityId {
  const raw = window.localStorage.getItem('kryom.activity')

  if (
    raw === 'explorer' ||
    raw === 'search' ||
    raw === 'git' ||
    raw === 'run' ||
    raw === 'extensions' ||
    raw === 'connections' ||
    raw === 'home' ||
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

function readLocalDockableLoc(): DockableLoc {
  const fallback: DockableLoc = {
    git: 'primary',
    problems: 'primary',
    ai: 'primary',
    agent: 'primary',
    research: 'primary',
  }

  try {
    const raw = window.localStorage.getItem('kryom.panelLoc')

    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw) as Partial<DockableLoc>
    const next = { ...fallback }

    for (const id of DOCKABLE_IDS) {
      if (parsed[id] === 'bottom' || parsed[id] === 'primary') {
        next[id] = parsed[id]
      }
    }

    return next
  } catch {
    return fallback
  }
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
  const [panelLoc, setPanelLoc] = useState<DockableLoc>(() =>
    readLocalDockableLoc()
  )
  const [hosts, setHosts] = useState<Record<string, HTMLElement | null>>({})
  const [diagSummary, setDiagSummary] = useState<{
    count: number
    success: boolean
  } | null>(null)
  const [diagnosticsRun, setDiagnosticsRun] = useState<{
    nonce: number
  } | null>(null)
  const runNonce = useRef(0)

  // Stable per-key ref callbacks: a fresh closure every render would
  // detach/reattach the ref on each commit and loop setHosts forever.
  const hostCallbacks = useRef<
    Record<string, (el: HTMLElement | null) => void>
  >({})

  const hostRef = useCallback((key: string) => {
    if (!hostCallbacks.current[key]) {
      hostCallbacks.current[key] = (el: HTMLElement | null) => {
        setHosts((previous) =>
          previous[key] === el ? previous : { ...previous, [key]: el }
        )
      }
    }

    return hostCallbacks.current[key]
  }, [])

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
  const showEditor = centerView === 'editor' && activeTab !== null
  const staged: StageMode | null =
    centerView === 'chat' || centerView === 'agent' || centerView === 'research'
      ? centerView
      : null

  useEffect(() => {
    logOutput('app', 'KryomCode started')

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

  useEffect(() => {
    try {
      window.localStorage.setItem('kryom.panelLoc', JSON.stringify(panelLoc))
    } catch {
      // Layout persistence is best-effort.
    }
  }, [panelLoc])

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
  // disable workspace/editor commands accurately.
  useEffect(() => {
    kryom()
      .pushUIContext({
        hasWorkspace: workspace !== null,
        hasEditor: activeTab !== null,
      })
      .catch(() => undefined)
  }, [workspace, activeTab])

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
  async function saveTab(targetPath: string): Promise<boolean> {
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

  function movePanel(id: DockableId, loc: 'primary' | 'bottom') {
    setPanelLoc((previous) =>
      previous[id] === loc ? previous : { ...previous, [id]: loc }
    )
  }

  function selectActivity(id: ActivityId) {
    // Re-selecting the visible view collapses the sidebar, VS Code style.
    if (id === activity && sidebarVisible) {
      setSidebarVisible(false)
      return
    }

    setActivity(id)
    setSidebarVisible(true)

    if (id === 'git') {
      movePanel('git', 'primary')
      void refreshGitBranch()
    }

    if (id === 'run') {
      movePanel('problems', 'primary')
    }

    if (id === 'home') {
      setCenterView('home')
    }
  }

  function showSidebar(id: ActivityId) {
    setActivity(id)
    setSidebarVisible(true)

    if (id === 'git') {
      movePanel('git', 'primary')
      void refreshGitBranch()
    }

    if (id === 'run') {
      movePanel('problems', 'primary')
    }
  }

  function selectBottomTab(tab: BottomTab) {
    // Selecting a dockable bottom tab moves that panel here; the
    // sidebar or stage it came from shows a way back.
    if (
      tab === 'git' ||
      tab === 'problems' ||
      tab === 'ai' ||
      tab === 'agent' ||
      tab === 'research'
    ) {
      movePanel(tab, 'bottom')
    }

    setBottomTab(tab)
    setBottomOpen(true)
  }

  function showHome() {
    setCenterView('home')
  }

  function stageCenter(mode: StageMode) {
    movePanel(mode === 'chat' ? 'ai' : mode, 'primary')
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

    showSidebar('run')
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
          setActivity('home')
          setSidebarVisible(true)
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
          if (bottomTab === 'terminal' && bottomOpen) {
            setBottomOpen(false)
          } else {
            selectBottomTab('terminal')
          }
          break
        case 'view.output':
          selectBottomTab('output')
          break
        case 'view.toggleSidebar':
          setSidebarVisible((visible) => !visible)
          break
        case 'view.toggleBottom':
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
          selectBottomTab('terminal')
          reportStatus('Terminal cleared')
          break
        case 'terminal.focus':
          selectBottomTab('terminal')
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

  return (
    <main className="ide">
      <TitleBar
        workspaceRoot={workspace?.root ?? null}
        activeFile={showEditor ? (activeTab?.path ?? null) : null}
        dirty={dirty}
        canSave={dirty && !saving}
        busy={opening || saving || explorerLoading}
        autoSave={autoSave}
        onOpenProject={() => void openProject()}
        onSave={() => void saveEditor()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="shell">
        <ActivityBar
          active={activity}
          sidebarVisible={sidebarVisible}
          onSelect={selectActivity}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {sidebarVisible && (
          <>
            <aside className="sidebar" style={{ width: leftWidth }}>
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

              <div hidden={activity !== 'git'} className="tab-body">
                {panelLoc.git === 'primary' ? (
                  <div ref={hostRef('git-side')} className="dock-host" />
                ) : (
                  <DockPlaceholder
                    title="Source Control"
                    where="the bottom panel"
                    actionLabel="Show here"
                    onBringHere={() => movePanel('git', 'primary')}
                  />
                )}
              </div>

              <div hidden={activity !== 'run'} className="tab-body">
                {panelLoc.problems === 'primary' ? (
                  <div ref={hostRef('problems-side')} className="dock-host" />
                ) : (
                  <DockPlaceholder
                    title="Run and Diagnostics"
                    where="the bottom panel"
                    actionLabel="Show here"
                    onBringHere={() => movePanel('problems', 'primary')}
                  />
                )}
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
                  onStatus={reportStatus}
                  onOpenSourceControl={() => showSidebar('git')}
                />
              </div>

              <div hidden={activity !== 'home'} className="tab-body">
                <nav className="home-nav" aria-label="AI Workspace navigation">
                  <button
                    type="button"
                    className="home-nav-row"
                    onClick={showHome}
                  >
                    <span className="home-nav-name">Workspace home</span>
                    <span className="muted">
                      Compose prompts for Chat, Agent, or Research
                    </span>
                  </button>
                  <button
                    type="button"
                    className="home-nav-row"
                    onClick={() => stageCenter('chat')}
                  >
                    <span className="home-nav-name">AI Chat</span>
                    <span className="muted">
                      Answers with project and file context
                    </span>
                  </button>
                  <button
                    type="button"
                    className="home-nav-row"
                    onClick={() => stageCenter('agent')}
                  >
                    <span className="home-nav-name">Coding Agent</span>
                    <span className="muted">
                      Planned edits with approval and rollback
                    </span>
                  </button>
                  <button
                    type="button"
                    className="home-nav-row"
                    onClick={() => stageCenter('research')}
                  >
                    <span className="home-nav-name">Research</span>
                    <span className="muted">
                      Cited briefs from real paper search
                    </span>
                  </button>
                </nav>
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
          </>
        )}

        <section className="center">
          {showEditor && activeTab ? (
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
            />
          ) : staged ? (
            <section className="editor-panel stage">
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
                {panelLoc[staged === 'chat' ? 'ai' : staged] === 'primary' ? (
                  <div
                    ref={hostRef(`${staged}-center`)}
                    className="dock-host"
                  />
                ) : (
                  <DockPlaceholder
                    title={
                      staged === 'chat'
                        ? 'AI Chat'
                        : staged === 'agent'
                          ? 'Agent'
                          : 'Research'
                    }
                    where="the bottom panel"
                    actionLabel="Bring to center stage"
                    onBringHere={() =>
                      movePanel(staged === 'chat' ? 'ai' : staged, 'primary')
                    }
                  />
                )}
              </div>
            </section>
          ) : (
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
                onShowAiChat={() => stageCenter('chat')}
                onShowResearch={() => stageCenter('research')}
                onShowTerminal={() => selectBottomTab('terminal')}
                onSubmitChat={handleWelcomeChat}
                onSubmitAgent={handleWelcomeAgent}
                onSubmitResearch={handleWelcomeResearch}
              />
            </section>
          )}
        </section>
      </div>

      {/* Always mounted (hidden when collapsed) so terminal history,
          output, and docked panels survive collapsing the panel. */}
      <div hidden={!bottomOpen} className="bottom-mounted">
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
        <section className="bottom-panel" style={{ height: bottomHeight }}>
          <div className="bottom-tabs">
            <button
              className={bottomTab === 'terminal' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => selectBottomTab('terminal')}
            >
              TERMINAL
            </button>
            <button
              className={bottomTab === 'problems' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => selectBottomTab('problems')}
            >
              PROBLEMS
            </button>
            <button
              className={bottomTab === 'output' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => selectBottomTab('output')}
            >
              OUTPUT
            </button>
            <button
              className={bottomTab === 'git' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => selectBottomTab('git')}
            >
              GIT
            </button>
            <button
              className={bottomTab === 'ai' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => selectBottomTab('ai')}
            >
              AI CHAT
            </button>
            <button
              className={bottomTab === 'agent' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => selectBottomTab('agent')}
            >
              AGENT
            </button>
            <button
              className={bottomTab === 'research' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => selectBottomTab('research')}
            >
              RESEARCH
            </button>
            <button
              className="panel-tab bottom-collapse"
              onClick={() => setBottomOpen(false)}
              title="Collapse bottom panel"
              aria-label="Collapse bottom panel"
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
              {panelLoc.problems === 'bottom' ? (
                <div ref={hostRef('problems-bottom')} className="dock-host" />
              ) : (
                <DockPlaceholder
                  title="Problems"
                  where="the Run and Diagnostics sidebar"
                  actionLabel="Show here"
                  onBringHere={() => movePanel('problems', 'bottom')}
                />
              )}
            </div>
            <div hidden={bottomTab !== 'output'} className="tab-body">
              <OutputPanel />
            </div>
            <div hidden={bottomTab !== 'git'} className="tab-body">
              {panelLoc.git === 'bottom' ? (
                <div ref={hostRef('git-bottom')} className="dock-host" />
              ) : (
                <DockPlaceholder
                  title="Source Control"
                  where="the sidebar"
                  actionLabel="Show here"
                  onBringHere={() => movePanel('git', 'bottom')}
                />
              )}
            </div>
            <div hidden={bottomTab !== 'ai'} className="tab-body">
              {panelLoc.ai === 'bottom' ? (
                <div ref={hostRef('ai-bottom')} className="dock-host" />
              ) : (
                <DockPlaceholder
                  title="AI Chat"
                  where="the center stage"
                  actionLabel="Show here"
                  onBringHere={() => movePanel('ai', 'bottom')}
                />
              )}
            </div>
            <div hidden={bottomTab !== 'agent'} className="tab-body">
              {panelLoc.agent === 'bottom' ? (
                <div ref={hostRef('agent-bottom')} className="dock-host" />
              ) : (
                <DockPlaceholder
                  title="Agent"
                  where="the center stage"
                  actionLabel="Show here"
                  onBringHere={() => movePanel('agent', 'bottom')}
                />
              )}
            </div>
            <div hidden={bottomTab !== 'research'} className="tab-body">
              {panelLoc.research === 'bottom' ? (
                <div ref={hostRef('research-bottom')} className="dock-host" />
              ) : (
                <DockPlaceholder
                  title="Research"
                  where="the center stage"
                  actionLabel="Show here"
                  onBringHere={() => movePanel('research', 'bottom')}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Single-mounted dockable panels. Each portal paints into its
          current host (sidebar, stage, or bottom) without remounting,
          so conversations, plans, and research survive every move. */}
      <Docked
        id="git"
        primary={hosts['git-side'] ?? null}
        secondary={hosts['git-bottom'] ?? null}
        usePrimary={panelLoc.git === 'primary'}
      >
        <GitPanel
          workspaceRoot={workspace?.root ?? null}
          onStatus={reportStatus}
        />
      </Docked>

      <Docked
        id="problems"
        primary={hosts['problems-side'] ?? null}
        secondary={hosts['problems-bottom'] ?? null}
        usePrimary={panelLoc.problems === 'primary'}
      >
        <ProblemsPanel
          workspaceRoot={workspace?.root ?? null}
          scripts={scripts}
          onOpenFileAtLine={(path, line) => void openEditorFile(path, line)}
          onStatus={reportStatus}
          pendingRun={diagnosticsRun}
          onResult={(count, success) => setDiagSummary({ count, success })}
        />
      </Docked>

      <Docked
        id="ai"
        primary={hosts['chat-center'] ?? null}
        secondary={hosts['ai-bottom'] ?? null}
        usePrimary={panelLoc.ai === 'primary'}
      >
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
        />
      </Docked>

      <Docked
        id="agent"
        primary={hosts['agent-center'] ?? null}
        secondary={hosts['agent-bottom'] ?? null}
        usePrimary={panelLoc.agent === 'primary'}
      >
        <AgentPanel
          workspaceRoot={workspace?.root ?? null}
          defaultModel={settings.defaultModel}
          onFilesChanged={(paths) => void handleAgentFilesChanged(paths)}
          onStatus={reportStatus}
          pendingTask={welcomeAgentTask}
        />
      </Docked>

      <Docked
        id="research"
        primary={hosts['research-center'] ?? null}
        secondary={hosts['research-bottom'] ?? null}
        usePrimary={panelLoc.research === 'primary'}
      >
        <ResearchPanel
          workspaceRoot={workspace?.root ?? null}
          onStatus={reportStatus}
          onImplement={handleResearchImplement}
          onAsk={handleResearchAsk}
          pendingStart={welcomeResearchStart}
        />
      </Docked>

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
        onShowDiagnostics={() => showSidebar('run')}
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
