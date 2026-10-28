import { useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'

export interface SearchPanelProps {
  workspaceRoot: string | null
  onOpenMatch: (path: string, line?: number) => void
}

export function SearchPanel(props: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'name' | 'content'>('content')
  const [result, setResult] = useState<KryomSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  async function runSearch() {
    if (!props.workspaceRoot || !query.trim() || searching) {
      return
    }

    setSearching(true)
    setError('')

    try {
      const found = await kryom().searchFiles({ query: query.trim(), mode })
      setResult(found)
    } catch (e) {
      setResult(null)
      setError(errorMessage(e))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="search-panel">
      {!props.workspaceRoot ? (
        <p className="muted padded">Open a project to search it.</p>
      ) : (
        <>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault()
              void runSearch()
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files…"
              aria-label="Search query"
              maxLength={200}
            />
            <div className="search-mode">
              <label>
                <input
                  type="radio"
                  name="search-mode"
                  checked={mode === 'content'}
                  onChange={() => setMode('content')}
                />
                Content
              </label>
              <label>
                <input
                  type="radio"
                  name="search-mode"
                  checked={mode === 'name'}
                  onChange={() => setMode('name')}
                />
                Name
              </label>
              <button type="submit" disabled={!query.trim() || searching}>
                {searching ? '…' : 'Search'}
              </button>
            </div>
          </form>

          {error && <p className="inline-error">{error}</p>}

          {result && (
            <>
              <p className="muted padded">
                {result.matches.length} match
                {result.matches.length === 1 ? '' : 'es'} in{' '}
                {result.searchedFiles} files
                {result.truncated ? ' (truncated)' : ''}
              </p>

              <div className="search-results">
                {result.matches.map((match, index) => (
                  <button
                    key={`${match.path}:${match.line ?? 0}:${index}`}
                    className="search-result"
                    onClick={() => props.onOpenMatch(match.path, match.line)}
                    title={match.path}
                  >
                    <span className="search-path">{match.relativePath}</span>
                    {match.line !== undefined && (
                      <span className="search-line">
                        {match.line}: {match.text}
                      </span>
                    )}
                  </button>
                ))}

                {result.matches.length === 0 && (
                  <p className="muted padded">No matches found.</p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
