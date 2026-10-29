// Narrow vertical Activity Bar: one icon per sidebar view, settings
// pinned at the bottom. Icons are original stroke drawings in a
// 24x24 grid; no external icon font is required.

export type ActivityId =
  | 'explorer'
  | 'search'
  | 'git'
  | 'run'
  | 'extensions'
  | 'connections'
  | 'home'
  | 'profile'

export interface ActivityBarProps {
  active: ActivityId
  sidebarVisible: boolean
  onSelect: (id: ActivityId) => void
  onOpenSettings: () => void
  // Optional per-destination active state. The shell uses it for
  // destinations that open the center view or bottom panel instead
  // of the sidebar (AI Workspace, Source Control, Run).
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

const ICONS: Record<ActivityId, { label: string; paths: string[] }> = {
  explorer: {
    label: 'Explorer',
    paths: [
      'M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z',
      'M13 3v5h6',
      'M9 13h6M9 17h4',
    ],
  },
  search: {
    label: 'Search',
    paths: ['M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M20 20l-4.2-4.2'],
  },
  git: {
    label: 'Source Control',
    paths: [
      'M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6',
      'M6 3a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 6 3z',
      'M18 15a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 18 15z',
      'M6 15a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 6 15z',
    ],
  },
  run: {
    label: 'Run and Diagnostics',
    paths: ['M7 4l13 8-13 8z', 'M7 4v16'],
  },
  extensions: {
    label: 'Extensions',
    paths: [
      'M4 4h7v7H4z',
      'M13 4h7v7h-7z',
      'M4 13h7v7H4z',
      'M15.5 13.5l4 4m0-4l-4 4',
    ],
  },
  connections: {
    label: 'Connections',
    paths: [
      'M9 7V4M15 7V4',
      'M7 7h10v4a5 5 0 0 1-10 0z',
      'M12 16v5',
    ],
  },
  home: {
    label: 'AI Workspace',
    paths: [
      'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
      'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
    ],
  },
  profile: {
    label: 'Profile',
    paths: [
      'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
      'M4 21a8 8 0 0 1 16 0',
    ],
  },
}

const ORDER: ActivityId[] = [
  'explorer',
  'search',
  'git',
  'run',
  'extensions',
  'connections',
  'home',
  'profile',
]

export function ActivityBar(props: ActivityBarProps) {
  return (
    <nav className="activity-bar" aria-label="Activity Bar">
      <div className="activity-group" role="group" aria-label="Views">
        {ORDER.map((id) => {
          const icon = ICONS[id]
          const selected = props.isSelected
            ? props.isSelected(id)
            : props.active === id && props.sidebarVisible

          return (
            <button
              key={id}
              type="button"
              className={selected ? 'activity-btn active' : 'activity-btn'}
              title={icon.label}
              aria-label={icon.label}
              aria-pressed={selected}
              onClick={() => props.onSelect(id)}
            >
              <span className="activity-indicator" aria-hidden="true" />
              <Icon d={icon.paths} label={icon.label} />
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
