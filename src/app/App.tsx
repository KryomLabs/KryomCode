import { useCallback, useEffect, useRef, useState } from 'react'
import { kryom, errorMessage, isWriteConflict } from '../api/kryom'
import { baseName, joinName, parentDir } from '../utils/paths'
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
import { TopBar, StatusBar } from '../components/Chrome'
import { ResizeHandle } from '../components/ResizeHandle'
import { Explorer } from '../components/Explorer'
import { SearchPanel } from '../components/SearchPanel'
import { EditorPanel, type EditorApi } from '../components/EditorPanel'
import { AiChat } from '../components/AiChat'
import { AgentPanel } from '../components/AgentPanel'
import { TerminalPanel } from '../components/TerminalPanel'
import { ProblemsPanel } from '../components/ProblemsPanel'
import { GitPanel } from '../components/GitPanel'
import { SettingsModal } from '../components/SettingsModal'
import { WelcomePage } from '../components/WelcomePage'

type LeftTab = 'explorer' | 'search'
type RightTab = 'ai' | 'agent'
type BottomTab = 'terminal' | 'problems' | 'git'

const FALLBACK_SETTINGS: KryomSettings = {
  defaultModel: 'muse-spark-1.3',
  aiContextEnabled: true,
  panelLeftWidth: 260,
  panelRightWidth: 360,
  panelBottomHeight: 264,
}

// Panel sizing limits in pixels. Minimums keep controls usable, maximums
// keep the editor visible; the clamps below additionally reserve at least
// 280px for the editor (plus 2px for the divider handles) and 282px for
// the top workspace area.
const PANEL_LIMITS = {
  left: { min: 180, max: 420, fallback: 260 },
  right: { min: 300, max: 560, fallback: 360 },
  bottom: { min: 140, max: 640, fallback: 264 },
} as const

function clampLeftWidth(value: number, rightWidth: number): number {
  const max = Math.max(
    PANEL_LIMITS.left.min,
    Math.min(
      PANEL_LIMITS.left.max,
      window.innerWidth - rightWidth - 284
    )
  )

  return Math.min(max, Math.max(PANEL_LIMITS.left.min, Math.round(value)))
}

function clampRightWidth(value: number, leftWidth: number): number {
  const max = Math.max(
    PANEL_LIMITS.right.min,
    Math.min(
      PANEL_LIMITS.right.max,
      window.innerWidth - leftWidth - 284
    )
  )

  return Math.min(max, Math.max(PANEL_LIMITS.right.min, Math.round(value)))
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

function AppShell() {
  const dialogs = useDialogs()
  const [workspace, setWorkspace] = useState<KryomWorkspace | null>(null)
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  const [settings, setSettings] = useState<KryomSettings>(FALLBACK_SETTINGS)
  const [leftWidth, setLeftWidth] = useState(FALLBACK_SETTINGS.panelLeftWidth)
  const [rightWidth, setRightWidth] = useState(
    FALLBACK_SETTINGS.panelRightWidth
  )
  const [bottomHeight, setBottomHeight] = useState(
    FALLBACK_SETTINGS.panelBottomHeight
  )
  // Mirror of the live dimensions so drag-end persistence reads the
  // latest values without waiting for a re-render.
  const panelsRef = useRef({
    left: FALLBACK_SETTINGS.panelLeftWidth,
    right: FALLBACK_SETTINGS.panelRightWidth,
    bottom: FALLBACK_SETTINGS.panelBottomHeight,
  })
  const [summary, setSummary] = useState<KryomWorkspaceSummary | null>(null)
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')
  const [leftTab, setLeftTab] = useState<LeftTab>('explorer')
  const [rightTab, setRightTab] = useState<RightTab>('ai')
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal')
  const [bottomOpen, setBottomOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const editorApi = useRef<EditorApi | null>(null)

  const activeTab = activePath ? findTab(tabs, activePath) : null
  const dirty = activeTab !== null && isDirty(activeTab)

  useEffect(() => {
    kryom()
      .getSettings()
      .then((loaded) => {
        setSettings(loaded)

        const left = clampLeftWidth(
          loaded.panelLeftWidth,
          loaded.panelRightWidth
        )
        const right = clampRightWidth(loaded.panelRightWidth, left)
        const bottom = clampBottomHeight(loaded.panelBottomHeight)

        panelsRef.current = { left, right, bottom }
        setLeftWidth(left)
        setRightWidth(right)
        setBottomHeight(bottom)
      })
      .catch(() => undefined)
  }, [])

  // Keep the layout valid when the Electron window itself is resized.
  useEffect(() => {
    const onWindowResize = () => {
      const left = clampLeftWidth(
        panelsRef.current.left,
        panelsRef.current.right
      )
      const right = clampRightWidth(panelsRef.current.right, left)
      const bottom = clampBottomHeight(panelsRef.current.bottom)

      panelsRef.current = { left, right, bottom }
      setLeftWidth(left)
      setRightWidth(right)
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
        panelRightWidth: panels.right,
        panelBottomHeight: panels.bottom,
      })
      .catch(() => undefined)
  }, [])

  const resizeLeft = useCallback(
    (value: number) => {
      const next = clampLeftWidth(value, panelsRef.current.right)

      panelsRef.current.left = next
      setLeftWidth(next)
    },
    []
  )

  const resizeRight = useCallback(
    (value: number) => {
      const next = clampRightWidth(value, panelsRef.current.left)

      panelsRef.current.right = next
      setRightWidth(next)
    },
    []
  )

  const resizeBottom = useCallback((value: number) => {
    const next = clampBottomHeight(value)

    panelsRef.current.bottom = next
    setBottomHeight(next)
  }, [])

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '`') {
        event.preventDefault()
        setBottomOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [])

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
      setError(errorMessage(e))
    } finally {
      setExplorerLoading(false)
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
        setWorkspace(result)
        setTabs([])
        setActivePath(null)
        setStatus('Project opened')
      }
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function closeProject() {
    if (!workspace || !(await confirmDiscardTabs())) {
      return
    }

    try {
      await kryom().closeWorkspace()
      setWorkspace(null)
      setTabs([])
      setActivePath(null)
      setSummary(null)
      setStatus('Project closed')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function openEditorFile(targetPath: string, line?: number) {
    const existing = findTab(tabs, targetPath)

    if (existing) {
      setActivePath(existing.path)

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

      if (line !== undefined) {
        setPendingLine(line)
      }

      setStatus('File opened')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setOpening(false)
    }
  }

  function selectTab(targetPath: string) {
    if (findTab(tabs, targetPath)) {
      setActivePath(targetPath)
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
      setStatus('Reloaded from disk')
    } catch (e) {
      setError(errorMessage(e))
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
      setStatus('All changes saved')
    } catch (e) {
      setError(errorMessage(e))
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
      setStatus('No changes to save')
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
      setStatus('All changes saved')

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

      setError(errorMessage(e))

      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveEditor() {
    if (activePath) {
      await saveTab(activePath)
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
    setStatus('Tab closed')
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
    setStatus('Other tabs closed')
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
      setStatus(type === 'file' ? 'File created' : 'Folder created')

      if (type === 'file') {
        await openEditorFile(created.path)
      }
    } catch (e) {
      setError(errorMessage(e))
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
      setStatus('Renamed')
    } catch (e) {
      setError(errorMessage(e))
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
      setStatus('Deleted')
    } catch (e) {
      setError(errorMessage(e))
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
      setStatus(
        'Agent changed an open file with unsaved edits. Save to review the disk conflict.'
      )
    }
  }

  const projectInfo = summary
    ? `${summary.projectType}${
        summary.frameworks.length > 0
          ? ` · ${summary.frameworks.join(', ')}`
          : ''
      }`
    : null

  const scripts = summary ? Object.keys(summary.scripts) : []
  const platform = window.kryom?.platform ?? 'unknown'

  return (
    <main className="ide">
      <TopBar
        workspaceRoot={workspace?.root ?? null}
        canSave={dirty && !saving}
        busy={opening || saving || explorerLoading}
        onOpenProject={() => void openProject()}
        onCloseProject={() => void closeProject()}
        onSave={() => void saveEditor()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <section className="workspace">
        <aside className="sidebar" style={{ width: leftWidth }}>
          <div className="side-tabs">
            <button
              className={leftTab === 'explorer' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setLeftTab('explorer')}
            >
              EXPLORER
            </button>
            <button
              className={leftTab === 'search' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setLeftTab('search')}
            >
              SEARCH
            </button>
          </div>

          <div hidden={leftTab !== 'explorer'} className="tab-body">
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

          <div hidden={leftTab !== 'search'} className="tab-body">
            <SearchPanel
              workspaceRoot={workspace?.root ?? null}
              onOpenMatch={(path, line) => void openEditorFile(path, line)}
            />
          </div>
        </aside>

        <ResizeHandle
          orientation="vertical"
          direction={1}
          label="Resize explorer panel"
          value={leftWidth}
          min={PANEL_LIMITS.left.min}
          max={PANEL_LIMITS.left.max}
          onResize={resizeLeft}
          onResizeEnd={persistPanels}
        />

        {activeTab ? (
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
          />
        ) : (
          <section className="editor-panel">
            <WelcomePage
              workspaceRoot={workspace?.root ?? null}
              defaultModel={settings.defaultModel}
              onOpenProject={() => void openProject()}
              onShowAiChat={() => setRightTab('ai')}
              onShowTerminal={() => {
                setBottomTab('terminal')
                setBottomOpen(true)
              }}
            />
          </section>
        )}

        <ResizeHandle
          orientation="vertical"
          direction={-1}
          label="Resize AI panel"
          value={rightWidth}
          min={PANEL_LIMITS.right.min}
          max={PANEL_LIMITS.right.max}
          onResize={resizeRight}
          onResizeEnd={persistPanels}
        />

        <aside className="right-panel" style={{ width: rightWidth }}>
          <div className="right-panel-tabs">
            <button
              className={rightTab === 'ai' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setRightTab('ai')}
            >
              AI CHAT
            </button>
            <button
              className={rightTab === 'agent' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setRightTab('agent')}
            >
              AGENT
            </button>
          </div>

          <div hidden={rightTab !== 'ai'} className="tab-body">
            <AiChat
              workspaceRoot={workspace?.root ?? null}
              activeFile={activeTab?.path ?? null}
              fileName={activeTab ? baseName(activeTab.path) : ''}
              fileContent={activeTab?.content ?? ''}
              dirty={dirty}
              defaultModel={settings.defaultModel}
              contextEnabled={settings.aiContextEnabled}
              onStatus={setStatus}
            />
          </div>

          <div hidden={rightTab !== 'agent'} className="tab-body">
            <AgentPanel
              workspaceRoot={workspace?.root ?? null}
              defaultModel={settings.defaultModel}
              onFilesChanged={(paths) => void handleAgentFilesChanged(paths)}
              onStatus={setStatus}
            />
          </div>
        </aside>
      </section>

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
          <section className="bottom-panel" style={{ height: bottomHeight }}>
          <div className="bottom-tabs">
            <button
              className={bottomTab === 'terminal' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setBottomTab('terminal')}
            >
              TERMINAL
            </button>
            <button
              className={bottomTab === 'problems' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setBottomTab('problems')}
            >
              PROBLEMS
            </button>
            <button
              className={bottomTab === 'git' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setBottomTab('git')}
            >
              GIT
            </button>
          </div>

          <div className="bottom-body">
            <div hidden={bottomTab !== 'terminal'} className="tab-body">
              <TerminalPanel
                workspaceRoot={workspace?.root ?? null}
                onStatus={setStatus}
              />
            </div>
            <div hidden={bottomTab !== 'problems'} className="tab-body">
              <ProblemsPanel
                workspaceRoot={workspace?.root ?? null}
                scripts={scripts}
                onOpenFileAtLine={(path, line) => void openEditorFile(path, line)}
                onStatus={setStatus}
              />
            </div>
            <div hidden={bottomTab !== 'git'} className="tab-body">
              <GitPanel
                workspaceRoot={workspace?.root ?? null}
                onStatus={setStatus}
              />
            </div>
          </div>
        </section>
        </>
      )}

      <StatusBar
        status={status}
        fileName={activeTab ? baseName(activeTab.path) : null}
        dirty={dirty}
        platform={platform}
        bottomOpen={bottomOpen}
        onToggleBottom={() => setBottomOpen((open) => !open)}
      />

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        initial={settings}
        onClose={() => setSettingsOpen(false)}
        onSaved={(next) => {
          setSettings(next)
          setStatus('Settings saved')
        }}
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
