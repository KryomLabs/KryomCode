import { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { detectLanguage } from '../utils/languages'
import { resolveAgainstRoot, samePath } from '../utils/paths'
import { EditorTabs } from './EditorTabs'
import type { TabState } from '../utils/tabs'

export interface EditorApi {
  revealLine: (line: number) => void
  find: () => void
  replace: () => void
  expandSelection: () => void
  shrinkSelection: () => void
}

// Minimal structural types for the Monaco instance. The real editor is
// a supertype of these, so mounting stays type-safe without importing
// the whole Monaco API surface.
interface MonacoTextModel {
  getLineCount: () => number
}

interface MonacoMarkerData {
  severity: number
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  source?: string
}

interface MonacoEditorInstance {
  revealLineInCenter: (line: number) => void
  setPosition: (position: { lineNumber: number; column: number }) => void
  addCommand: (keybinding: number, handler: () => void) => void
  getModel: () => MonacoTextModel | null
  trigger: (source: string, handlerId: string, payload?: unknown) => void
  onDidChangeCursorPosition: (
    listener: (event: {
      position: { lineNumber: number; column: number }
    }) => void
  ) => { dispose: () => void }
}

interface MonacoApi {
  KeyMod: { CtrlCmd: number; Shift: number }
  KeyCode: { KeyS: number; F8: number }
  MarkerSeverity: { Error: number; Warning: number }
  editor: {
    setModelMarkers: (
      model: MonacoTextModel,
      owner: string,
      markers: MonacoMarkerData[]
    ) => void
  }
}

export interface EditorPanelProps {
  tabs: TabState[]
  activeTabPath: string
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onCloseOthers: (keepPath: string) => void
  filePath: string | null
  fileName: string
  content: string
  dirty: boolean
  pendingLine: number | null
  onChange: (value: string) => void
  onSave: () => void
  onRevealConsumed: () => void
  registerApi: (api: EditorApi | null) => void
  fontSize?: number
  onCursorChange?: (line: number, column: number) => void
  workspaceRoot?: string | null
  markers?: KryomDiagnostic[]
  saving?: boolean
}

export function EditorPanel(props: EditorPanelProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const saveRef = useRef(props.onSave)
  saveRef.current = props.onSave
  const registerRef = useRef(props.registerApi)
  registerRef.current = props.registerApi
  // Live mirrors so marker application (triggered from mount and
  // effects) always sees the latest diagnostics and file identity.
  const markersRef = useRef(props.markers)
  markersRef.current = props.markers
  const fileRef = useRef({
    path: props.filePath,
    root: props.workspaceRoot ?? null,
  })
  fileRef.current = {
    path: props.filePath,
    root: props.workspaceRoot ?? null,
  }

  useEffect(() => {
    return () => registerRef.current(null)
  }, [])

  // Applies the diagnostics that belong to the open file as gutter
  // markers. Positions are clamped into the model; an empty set
  // clears stale markers. Monaco's built-in F8/Shift+F8 marker
  // navigation picks these up with no extra wiring.
  function applyMarkers() {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel() ?? null
    const filePath = fileRef.current.path

    if (!editor || !monaco || !model || !filePath) {
      return
    }

    const maxLine = Math.max(1, model.getLineCount())
    const data: MonacoMarkerData[] = (markersRef.current ?? [])
      .filter((diagnostic) =>
        samePath(
          resolveAgainstRoot(fileRef.current.root, diagnostic.file),
          filePath
        )
      )
      .map((diagnostic) => {
        const line = Math.min(
          Math.max(1, diagnostic.line || 1),
          maxLine
        )
        const column = Math.max(1, diagnostic.column || 1)

        return {
          severity:
            diagnostic.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Error,
          message: diagnostic.code
            ? `${diagnostic.message} (${diagnostic.code})`
            : diagnostic.message,
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column + 1,
          source: diagnostic.source || 'kryom',
        }
      })

    monaco.editor.setModelMarkers(model, 'kryom', data)
  }

  useEffect(() => {
    applyMarkers()
  })

  useEffect(() => {
    if (props.pendingLine === null || !props.filePath) {
      return
    }

    const line = props.pendingLine
    const timer = setTimeout(() => {
      const editor = editorRef.current
      const model = editor?.getModel() ?? null
      const maxLine = model?.getLineCount() ?? line
      const safeLine = Math.min(Math.max(1, line), Math.max(1, maxLine))

      editor?.revealLineInCenter(safeLine)
      editor?.setPosition({ lineNumber: safeLine, column: 1 })
      props.onRevealConsumed()
    }, 80)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingLine, props.filePath])

  if (!props.filePath) {
    return (
      <section className="editor-panel">
        <div className="tabbar">No file open</div>
        <div className="welcome">
          <h1>Your workspace.</h1>
          <p>Open a project and select a file to start editing.</p>
          <p>Use AI Chat to ask questions about your code.</p>
        </div>
      </section>
    )
  }

  const cursorRef = useRef(props.onCursorChange)
  cursorRef.current = props.onCursorChange

  const handleMount = (editor: MonacoEditorInstance, monaco: MonacoApi) => {
    editorRef.current = editor
    monacoRef.current = monaco
    applyMarkers()
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current()
    })
    // Explicit marker navigation so F8/Shift+F8 always cycle the
    // KryomCode diagnostics, regardless of Monaco defaults.
    editor.addCommand(monaco.KeyCode.F8, () => {
      editor.trigger('shortcuts', 'editor.action.marker.next')
    })
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F8, () => {
      editor.trigger('shortcuts', 'editor.action.marker.prev')
    })
    editor.onDidChangeCursorPosition((event) => {
      cursorRef.current?.(
        event.position.lineNumber,
        event.position.column
      )
    })
    registerRef.current({
      revealLine: (line: number) => {
        const model = editor.getModel()
        const maxLine = model?.getLineCount() ?? line
        const safeLine = Math.min(Math.max(1, line), Math.max(1, maxLine))

        editor.revealLineInCenter(safeLine)
        editor.setPosition({ lineNumber: safeLine, column: 1 })
      },
      find: () => editor.trigger('menu', 'actions.find'),
      replace: () => editor.trigger('menu', 'editor.action.startFindReplaceAction'),
      expandSelection: () =>
        editor.trigger('menu', 'editor.action.smartSelect.expand'),
      shrinkSelection: () =>
        editor.trigger('menu', 'editor.action.smartSelect.shrink'),
    })
  }

  return (
    <section className="editor-panel">
      <EditorTabs
        tabs={props.tabs}
        activePath={props.activeTabPath}
        onSelect={props.onSelectTab}
        onClose={props.onCloseTab}
        onCloseOthers={props.onCloseOthers}
      />
      <div className="tabbar">
        <span className="tab-name">
          {props.fileName}
          {props.dirty ? ' •' : ''}
        </span>
        <span className="spacer" />
        <span className="muted">{detectLanguage(props.fileName)}</span>
        <button
          type="button"
          className="mini-btn"
          onClick={props.onSave}
          disabled={!props.dirty || props.saving === true}
          title="Save the active file (Ctrl+S)"
          aria-label={
            props.dirty ? 'Save the active file' : 'No unsaved changes'
          }
        >
          {props.saving === true ? 'Saving…' : 'Save'}
        </button>
      </div>

      <Editor
        height="100%"
        path={props.filePath}
        language={detectLanguage(props.fileName)}
        theme="vs-dark"
        value={props.content}
        onChange={(value) => props.onChange(value ?? '')}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: props.fontSize ?? 14,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          readOnly: false,
          padding: { top: 12 },
          renderLineHighlight: 'all',
        }}
      />
    </section>
  )
}
