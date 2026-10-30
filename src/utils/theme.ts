// Application color theme. Persisted like other renderer prefs
// (`kryom.*` localStorage keys); applied as `data-theme` on the
// document element, which the stylesheets key off. Dark is the
// default; the OS preference only decides the very first run.
export type KryomTheme = 'dark' | 'light'

const STORAGE_KEY = 'kryom.theme'

export function getStoredTheme(): KryomTheme {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw === 'light' || raw === 'dark') {
      return raw
    }
  } catch {
    // Storage unavailable: fall through to the default.
  }

  return 'dark'
}

export function systemPrefersLight(): boolean {
  try {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: light)').matches &&
      window.localStorage.getItem(STORAGE_KEY) === null
    )
  } catch {
    return false
  }
}

export function initialTheme(): KryomTheme {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === null && systemPrefersLight()) {
      return 'light'
    }
  } catch {
    // Ignore and use the stored/default value.
  }

  return getStoredTheme()
}

export function applyTheme(theme: KryomTheme): void {
  document.documentElement.dataset.theme = theme

  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private mode etc: the attribute still applies for the session.
  }

  const meta = document.querySelector('meta[name="theme-color"]')

  if (meta) {
    meta.setAttribute('content', theme === 'light' ? '#f4f4f6' : '#101114')
  }
}

export function monacoTheme(theme: KryomTheme): 'vs' | 'vs-dark' {
  return theme === 'light' ? 'vs' : 'vs-dark'
}
