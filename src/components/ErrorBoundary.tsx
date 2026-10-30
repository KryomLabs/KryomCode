// Top-level React error boundary. A render crash (corrupt restored
// state, Monaco init failure, unexpected null) shows a recovery
// screen instead of a blank window. Event-handler errors are NOT
// caught here — those paths report inline by design.
import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  compact?: boolean
  title?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  componentDidCatch(): void {
    // The message renders below; nothing sensitive is logged.
  }

  render(): ReactNode {
    if (this.state.error) {
      // Compact regional mode: one crashed panel recovers inline
      // instead of blanking the whole IDE.
      if (this.props.compact) {
        return (
          <div className="panel-crash" role="alert">
            <span>
              {this.props.title ?? 'This panel crashed.'} Files on disk
              are untouched — reloading restores the workspace.
            </span>
            <button
              type="button"
              className="mini-btn"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        )
      }
      return (
        <main className="ide">
          <div className="welcome" role="alert">
            <h1>Something went wrong.</h1>
            <p>
              KryomCode hit a rendering error. Your files on disk are
              untouched — reloading restores the workspace from saved
              state.
            </p>
            <p className="muted">{this.state.error.message}</p>
            <p>
              <button
                type="button"
                className="primary-button"
                onClick={() => window.location.reload()}
              >
                Reload KryomCode
              </button>
            </p>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}
