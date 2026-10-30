// Narrow vertical Activity Bar driven by the activity registry
// (Level 3C, Phase 1; Level 4 readiness). Destinations render from
// registered definitions in order, so future modules add navigation
// without touching the shell. Settings stays pinned at the bottom.
// Keyboard: the bar is one tab stop with arrow-key navigation.

import { useEffect, useRef } from 'react'
import {
  listActivities,
  registerBuiltinActivities,
} from './activity-registry'

export type ActivityId = string

export interface ActivityBarProps {
  active: ActivityId
  sidebarVisible: boolean
  onSelect: (id: ActivityId) => void
  onOpenSettings: () => void
  // Optional per-destination active state. The shell uses it for
  // destinations that switch the center view or bottom panel instead
  // of the sidebar.
  isSelected?: (id: ActivityId) => boolean
}

function Icon({ d, label }: { d: string[]; label: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <title>{label}</title>
      {d.map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  )
}

export function ActivityBar(props: ActivityBarProps) {
  registerBuiltinActivities()

  const activities = listActivities()
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedRef = useRef(props.isSelected)
  selectedRef.current = props.isSelected

  useEffect(() => {
    registerBuiltinActivities()
  }, [])

  function isActive(id: string): boolean {
    const custom = selectedRef.current

    if (custom) {
      return custom(id)
    }

    return props.active === id && props.sidebarVisible
  }

  function onBarKeyDown(event: React.KeyboardEvent) {
    const current = document.activeElement
    const index = activities.findIndex(
      (entry) => buttonRefs.current.get(entry.id) === current
    )

    if (index === -1) {
      return
    }

    let next: number | null = null

    if (event.key === 'ArrowDown') {
      next = (index + 1) % activities.length
    } else if (event.key === 'ArrowUp') {
      next = (index - 1 + activities.length) % activities.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = activities.length - 1
    }

    if (next !== null) {
      event.preventDefault()
      buttonRefs.current.get(activities[next].id)?.focus()
    }
  }

  const selectedIndex = Math.max(
    0,
    activities.findIndex((entry) => isActive(entry.id))
  )

  return (
    <nav
      className="activity-bar"
      aria-label="Activity Bar"
      onKeyDown={onBarKeyDown}
    >
      <div
        className="activity-group"
        role="group"
        aria-label="Views"
      >
        {activities.map((entry, index) => {
          const selected = isActive(entry.id)

          return (
            <button
              key={entry.id}
              ref={(element) => {
                if (element) {
                  buttonRefs.current.set(entry.id, element)
                } else {
                  buttonRefs.current.delete(entry.id)
                }
              }}
              type="button"
              className={selected ? 'activity-btn active' : 'activity-btn'}
              title={entry.hint ? `${entry.label} — ${entry.hint}` : entry.label}
              aria-label={entry.label}
              aria-pressed={selected}
              tabIndex={index === selectedIndex ? 0 : -1}
              onClick={() => props.onSelect(entry.id)}
            >
              <span className="activity-indicator" aria-hidden="true" />
              <Icon d={entry.paths} label={entry.label} />
            </button>
          )
        })}
      </div>

      <div className="activity-group bottom" role="group" aria-label="Manage">
        <button
          type="button"
          className="activity-btn"
          title="Settings"
          aria-label="Settings"
          onClick={props.onOpenSettings}
        >
          <span className="activity-indicator" aria-hidden="true" />
          <Icon
            label="Settings"
            d={[
              'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
              'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z',
            ]}
          />
        </button>
      </div>
    </nav>
  )
}
