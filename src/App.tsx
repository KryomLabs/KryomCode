import { useState } from 'react'
import Editor from '@monaco-editor/react'

type Node = KryomNode
type ChatMessage = KryomAIMessage
type RightPanel = 'terminal' | 'ai'

function App() {
  const [workspace, setWorkspace] =
    useState<KryomWorkspace | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')

  const [command, setCommand] = useState('npm run build')
  const [terminalOutput, setTerminalOutput] = useState(
    'Open a project to run commands.',
  )
  const [running, setRunning] = useState(false)

  const [rightPanel, setRightPanel] =
    useState<RightPanel>('terminal')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [includeFileContext, setIncludeFileContext] = useState(true)

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
        setTerminalOutput('Project opened. Enter a command to run it.')
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
            className={
              'tree-row file-row ' +
              (activeFile === node.path ? 'selected' : '')
            }
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => void openFile(node)}
            key={node.path}
          >
            📄 {node.name}
          </button>
        )}
      </div>
    ))
  }

  async function runTerminalCommand() {
    if (!workspace || running || !command.trim()) return

    setRunning(true)
    setError('')
    setTerminalOutput(`> ${command}\nRunning...\n`)

    try {
      const result = await window.kryom.runCommand(command)

      setTerminalOutput(
        `> ${command}\n${result.output}\n\nExit code: ${result.exitCode}`,
      )

      setStatus(
        result.exitCode === 0
          ? 'Command completed'
          : 'Command failed',
      )
    } catch (e) {
      setTerminalOutput(`Terminal error: ${String(e)}`)
      setStatus('Terminal error')
    } finally {
      setRunning(false)
    }
  }

  async function sendAIMessage() {
    const userPrompt = prompt.trim()
    if (!userPrompt || aiLoading) return

    setAiError('')
    setPrompt('')
    setRightPanel('ai')
    setAiLoading(true)

    const userMessage: ChatMessage = {
      role: 'user',
      content: userPrompt,
    }

    try {
      let context = ''

      if (includeFileContext && activeFile) {
        context =
          `Active file: ${activeFile}\n` +
          `Unsaved changes are included if present.\n\n` +
          content.slice(0, 18000)
      } else if (workspace) {
        context = `Workspace root: ${workspace.root}`
      }

      const result = await window.kryom.askAI({
        prompt: userPrompt,
        context,
        history: messages.slice(-10),
      })

      setMessages((previous) => [
        ...previous,
        userMessage,
        { role: 'assistant', content: result.answer },
      ])
      setStatus(`AI response received (${result.model})`)
    } catch (e) {
      setMessages((previous) => [...previous, userMessage])
      setAiError(
        e instanceof Error ? e.message : String(e),
      )
    } finally {
      setAiLoading(false)
    }
  }

  function clearChat() {
    if (aiLoading) return
    setMessages([])
    setAiError('')
    setStatus('AI chat cleared')
  }

  return (
    <main className="ide">
      <header className="topbar">
        <strong className="brand">KryomCode</strong>

        <button onClick={() => void openWorkspace()}>
          Open Project
        </button>

        <span className="muted">
          {workspace?.root ?? 'No project selected'}
        </span>

        <span className="spacer" />

        <button
          onClick={() => void saveFile()}
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
            <p className="muted">
              Open a folder to get started.
            </p>
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
              <p>
                Open a project and select a file to start editing.
              </p>
              <p>Use AI Chat to ask questions about your code.</p>
            </div>
          )}
        </section>

        <aside className="right-panel">
          <div className="right-panel-tabs">
            <button
              className={rightPanel === 'terminal' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setRightPanel('terminal')}
            >
              TERMINAL
            </button>
            <button
              className={rightPanel === 'ai' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setRightPanel('ai')}
            >
              AI CHAT
            </button>
          </div>

          {rightPanel === 'terminal' ? (
            <section className="terminal-panel">
              <div className="terminal-heading">
                <span>PROJECT TERMINAL</span>
                <span className="muted">
                  {running ? 'Running command...' : 'Workspace'}
                </span>
              </div>

              <form
                className="terminal-input"
                onSubmit={(event) => {
                  event.preventDefault()
                  void runTerminalCommand()
                }}
              >
                <span className="prompt-symbol">&gt;</span>

                <input
                  aria-label="Terminal command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="Enter a command..."
                  disabled={!workspace || running}
                />

                <button
                  type="submit"
                  disabled={!workspace || running || !command.trim()}
                >
                  {running ? 'Running…' : 'Run'}
                </button>
              </form>

              <pre className="terminal-output">{terminalOutput}</pre>
            </section>
          ) : (
            <section className="ai-panel">
              <div className="ai-heading">
                <div>
                  <strong>Kryom AI</strong>
                  <div className="muted">
                    Meta Muse · API key configured separately
                  </div>
                </div>
                <button
                  onClick={clearChat}
                  disabled={aiLoading || messages.length === 0}
                  title="Clear conversation"
                >
                  Clear
                </button>
              </div>

              <label className="context-toggle">
                <input
                  type="checkbox"
                  checked={includeFileContext}
                  onChange={(event) =>
                    setIncludeFileContext(event.target.checked)
                  }
                />
                Include active file context
              </label>

              {includeFileContext && activeFile ? (
                <div className="context-file">
                  Context: {fileName}
                  {content !== savedContent ? ' (unsaved edits)' : ''}
                </div>
              ) : (
                <div className="context-file">
                  {includeFileContext
                    ? 'No active file. Workspace context will be used.'
                    : 'File context is disabled.'}
                </div>
              )}

              <div className="ai-messages" aria-live="polite">
                {messages.length === 0 && (
                  <div className="ai-empty">
                    <div className="ai-empty-icon">✦</div>
                    <h3>What are we building?</h3>
                    <p>
                      Ask for code explanations, debugging help,
                      implementation ideas or tests.
                    </p>
                    <p className="muted">
                      AI suggestions do not change files automatically.
                    </p>
                  </div>
                )}

                {messages.map((message, index) => (
                  <article
                    className={`chat-message ${message.role}`}
                    key={`${index}-${message.role}`}
                  >
                    <div className="message-role">
                      {message.role === 'user' ? 'YOU' : 'KRYOM AI'}
                    </div>
                    <pre>{message.content}</pre>
                  </article>
                ))}

                {aiLoading && (
                  <div className="ai-loading" role="status">
                    <span className="loading-dot" />
                    Kryom AI is thinking…
                  </div>
                )}

                <div id="ai-message-end" />
              </div>

              {aiError && (
                <div className="ai-error" role="alert">
                  <strong>AI request failed</strong>
                  <p>{aiError}</p>
                  <button
                    onClick={() => setAiError('')}
                    className="secondary-button"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <form
                className="ai-composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendAIMessage()
                }}
              >
                <textarea
                  aria-label="Ask Kryom AI"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask Kryom AI anything about your code…"
                  rows={4}
                  maxLength={12000}
                  disabled={aiLoading}
                />

                <div className="composer-footer">
                  <span className="muted">
                    {prompt.length}/12000
                  </span>
                  <button
                    type="submit"
                    disabled={aiLoading || !prompt.trim()}
                  >
                    {aiLoading ? 'Thinking…' : 'Send ↑'}
                  </button>
                </div>
              </form>
            </section>
          )}
        </aside>
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