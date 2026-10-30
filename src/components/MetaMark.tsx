// Meta AI identity mark: an original infinity-loop drawing used as
// the Meta AI session identity across tabs, headers, and the editor
// toolbar. Compact and monochrome-safe; the gradient variant is
// reserved for the workspace header and the new-session button.

const INFINITY_PATH =
  'M18.6 6.6c-2 0-3.4 1.2-4.5 2.7l-2.1 3.4-2.1-3.4C8.8 7.8 7.4 6.6 5.4 ' +
  '6.6a4.1 4.1 0 0 0 0 8.2c2 0 3.4-1.2 4.5-2.7l2.1-3.4 2.1 3.4c1.1 1.5 ' +
  '2.5 2.7 4.5 2.7a4.1 4.1 0 0 0 0-8.2z'

export function MetaMark({
  size = 14,
  gradient = false,
  label = 'Meta AI',
}: {
  size?: number
  gradient?: boolean
  label?: string
}) {
  if (!gradient) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={label === undefined ? true : undefined}
        focusable="false"
        role={label === undefined ? undefined : 'img'}
        aria-label={label}
      >
        <path d={INFINITY_PATH} />
      </svg>
    )
  }

  // Stable gradient id per instance size avoids collisions when
  // several headers mount at once.
  const gid = `meta-ai-g-${size}`

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={`url(#${gid})`}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
    >
      <defs>
        <linearGradient
          id={gid}
          x1="2"
          y1="12"
          x2="22"
          y2="12"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#0082FB" />
          <stop offset="1" stopColor="#0064E0" />
        </linearGradient>
      </defs>
      <path d={INFINITY_PATH} />
    </svg>
  )
}
