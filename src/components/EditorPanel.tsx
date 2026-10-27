import { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { detectLanguage } from '../utils/languages'
import { EditorTabs } from './EditorTabs'
import type { TabState } from '../utils/tabs'

export interface EditorApi {
  revealLine: (line: number) => void
}

// Minimal structural types for the Monaco instance. The real editor is
// a supertype of these, so mounting stays type-safe without importing
// the whole Monaco API surface.
interface MonacoEditorInstance {
  revealLineInCenter: (line: number) => void
  setPosition: (position: { lineNumber: number; column: number }) => void
  addCommand: (keybinding: number, handler: () => void) => void
  getModel: () => { getLineCount: () => number } | null
}

interface MonacoApi {
  KeyMod: { CtrlCmd: number }
  KeyCode: { KeyS: number }
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
}

export function EditorPanel(props: EditorPanelProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const saveRef = useRef(props.onSave)
  saveRef.current = props.onSave
  const registerRef = useRef(props.registerApi)
  registerRef.current = props.registerApi

  useEffect(() => {
    return () => registerRef.current(null)
  }, [])

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

  const handleMount = (editor: MonacoEditorInstance, monaco: MonacoApi) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current()
    })
    registerRef.current({
      revealLine: (line: number) => {
        const model = editor.getModel()
        const maxLine = model?.getLineCount() ?? line
        const safeLine = Math.min(Math.max(1, line), Math.max(1, maxLine))

        editor.revealLineInCenter(safeLine)
        editor.setPosition({ lineNumber: safeLine, column: 1 })
      },
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
          fontSize: 14,
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
