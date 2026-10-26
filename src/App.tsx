function App() {
  return (
    <main className="app">
      <div className="status">KRYOMCODE / DESKTOP</div>
      <h1>Welcome to KryomCode.</h1>
      <p>Your desktop development workspace is running.</p>

      <div className="panel">
        <span className="dot" />
        Electron connected successfully
      </div>

      <p>Platform: {window.kryom.platform}</p>
      <p>Electron: {window.kryom.versions.electron}</p>
    </main>
  )
}

export default App