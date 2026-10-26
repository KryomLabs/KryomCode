import { useState } from 'react'
import Editor from '@monaco-editor/react'

type Node = KryomNode

function App() {
  const [workspace, setWorkspace] =
    useState<KryomWorkspace | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')

  async function openWorkspace() {
    try {
      setError('')
      const result = await window.kryom.openWorkspace()

      if (result) {
        setWorkspace(result)
        setActiveFile(null)
        setFileName('')
        setContent('')
        setSavedContent('')
        setStatus('Project opened')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  async function openFile(node: Node) {
    if (node.type !== 'file') return

    try {
      setError('')
      const text = await window.kryom.readFile(node.path)

      setActiveFile(node.path)
      setFileName(node.name)
      setContent(text)
      setSavedContent(text)
      setStatus('File opened')
    } catch (e) {
      setError(String(e))
    }
  }

  async function saveFile() {
    if (!activeFile) return

    try {
      setError('')
      await window.kryom.saveFile(activeFile, content)
      setSavedContent(content)
      setStatus('All changes saved')
    } catch (e) {
      setError(String(e))
    }
  }

  function renderTree(nodes: Node[], depth = 0) {
    return nodes.map((node) => (
      <div key={node.path}>
        {node.type === 'directory' ? (
          <details open={depth === 0}>
            <summary
              className="tree-row"
              style={{ paddingLeft: 12 + depth * 14 }}
            >
              📁 {node.name}
            </summary>
            {renderTree(node.children ?? [], depth + 1)}
          </details>
        ) : (
          <button
            key={node.path}
            className={
              'tree-row file-row ' +
              (activeFile === node.path ? 'selected' : '')
            }
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => openFile(node)}
          >
            📄 {node.name}
          </button>
        )}
      </div>
    ))
  }

  return (
    <main className="ide">
      <header className="topbar">
        <strong className="brand">KryomCode</strong>
        <button onClick={openWorkspace}>Open Project</button>
        <span className="muted">
          {workspace?.root ?? 'No project selected'}
        </span>
        <span className="spacer" />
        <button
          onClick={saveFile}
          disabled={!activeFile || content === savedContent}
        >
          Save File
        </button>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="section-title">EXPLORER</div>
          {workspace ? (
            <>
              <div className="root-name">
                📁 {workspace.root.split(/[\\/]/).pop()}
              </div>
              {renderTree(workspace.tree)}
            </>
          ) : (
            <p className="muted">Open a folder to get started.</p>
          )}
        </aside>

        <section className="editor-panel">
          <div className="tabbar">
            {fileName || 'No file open'}
            {activeFile && content !== savedContent ? ' •' : ''}
          </div>

          {activeFile ? (
            <Editor
              height="100%"
              path={activeFile}
              language="plaintext"
              theme="vs-dark"
              value={content}
              onChange={(value) => setContent(value ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: false,
              }}
            />
          ) : (
            <div className="welcome">
              <h1>Your workspace.</h1>
              <p>Open a project and select a file to start editing.</p>
            </div>
          )}
        </section>
      </section>

      <footer className="statusbar">
        <span>{status}</span>
        <span>{window.kryom.platform}</span>
      </footer>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
    </main>
  )
}

export default App