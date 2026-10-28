import { useEffect, useRef } from 'react'
import { baseName } from '../utils/paths'
import { isDirty, type TabState } from '../utils/tabs'
import { FileIcon } from './FileIcons'

export interface EditorTabsProps {
  tabs: TabState[]
  activePath: string
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onCloseOthers: (keepPath: string) => void
}

// Roving-tabindex tab strip: the active tab's label is the single tab
// stop, arrow keys move focus and select, Home/End jump, and the
// active tab scrolls into view. Close buttons stay directly tabbable
// so closing never depends on the roving pattern.
export function EditorTabs(props: EditorTabsProps) {
  const labelRefs = useRef(new Map<string, HTMLButtonElement>())
  const stripRef = useRef<HTMLDivElement | null>(null)
  const prevCount = useRef(props.tabs.length)

  useEffect(() => {
    labelRefs.current
      .get(props.activePath)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.activePath, props.tabs.length])

  // Closing a tab unmounts its focused close button; move focus back
  // to the newly active tab instead of stranding it on the page body.
  useEffect(() => {
    if (props.tabs.length < prevCount.current) {
      const active = document.activeElement

      if (active && !stripRef.current?.contains(active)) {
        labelRefs.current.get(props.activePath)?.focus()
      }
    }

    prevCount.current = props.tabs.length
  })

  function focusTab(index: number) {
    const tab = props.tabs[index]

    if (!tab) {
      return
    }

    props.onSelect(tab.path)
    labelRefs.current.get(tab.path)?.focus()
  }

  function onLabelKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab((index + 1) % props.tabs.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab((index - 1 + props.tabs.length) % props.tabs.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusTab(props.tabs.length - 1)
    }
  }

  return (
    <div
      ref={stripRef}
      className="editor-tabs"
      role="tablist"
      aria-label="Open files"
    >
      {props.tabs.map((tab, index) => {
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
              ref={(element) => {
                if (element) {
                  labelRefs.current.set(tab.path, element)
                } else {
                  labelRefs.current.delete(tab.path)
                }
              }}
              className="tab-label"
              onClick={() => props.onSelect(tab.path)}
              onKeyDown={(event) => onLabelKeyDown(event, index)}
              tabIndex={active ? 0 : -1}
            >
              <span className="tab-file-icon" aria-hidden="true">
                <FileIcon />
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
