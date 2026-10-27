import { baseName } from '../utils/paths'
import { isDirty, type TabState } from '../utils/tabs'

export interface EditorTabsProps {
  tabs: TabState[]
  activePath: string
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onCloseOthers: (keepPath: string) => void
}

export function EditorTabs(props: EditorTabsProps) {
  return (
    <div className="editor-tabs" role="tablist" aria-label="Open files">
      {props.tabs.map((tab) => {
        const name = baseName(tab.path)
        const active = tab.path === props.activePath
        const dirty = isDirty(tab)

        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            aria-label={`${name}${dirty ? ', unsaved changes' : ''}`}
            title={tab.path}
            className={active ? 'editor-tab active' : 'editor-tab'}
          >
            <button
              className="tab-label"
              onClick={() => props.onSelect(tab.path)}
              tabIndex={active ? 0 : -1}
            >
              <span className="tab-file-icon" aria-hidden="true">
                📄
              </span>
              <span className="tab-name-text">{name}</span>
              {dirty && (
                <span className="tab-dirty" aria-hidden="true">
                  •
                </span>
              )}
            </button>
            <button
              className="tab-close"
              aria-label={`Close ${name}${dirty ? ' (unsaved changes)' : ''}`}
              title={`Close ${name}`}
              onClick={(event) => {
                event.stopPropagation()
                props.onClose(tab.path)
              }}
            >
              ×
            </button>
          </div>
        )
      })}

      {props.tabs.length > 1 && (
        <button
          className="tabs-close-others"
          onClick={() => props.onCloseOthers(props.activePath)}
        >
          Close others
        </button>
      )}
    </div>
  )
}
