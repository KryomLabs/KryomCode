// Theme preference tests: persistence, document application, OS
// fallback, and the Monaco theme mapping. Runs in jsdom through
// `npm run test:renderer`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  getStoredTheme,
  initialTheme,
  monacoTheme,
  systemPrefersLight,
} from './theme'

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: light)' ? matches : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  })
}

afterEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.remove()
  vi.restoreAllMocks()
})

describe('getStoredTheme', () => {
  it('returns the stored theme when valid', () => {
    window.localStorage.setItem('kryom.theme', 'light')
    expect(getStoredTheme()).toBe('light')
    window.localStorage.setItem('kryom.theme', 'dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('falls back to dark for missing or corrupt values', () => {
    expect(getStoredTheme()).toBe('dark')
    window.localStorage.setItem('kryom.theme', 'sepia')
    expect(getStoredTheme()).toBe('dark')
  })
})

describe('systemPrefersLight', () => {
  it('is false when matchMedia is unavailable', () => {
    // jsdom ships without matchMedia; the helper must not throw.
    expect(systemPrefersLight()).toBe(false)
  })

  it('is true only for a first run on a light OS theme', () => {
    mockMatchMedia(true)
    expect(systemPrefersLight()).toBe(true)
    window.localStorage.setItem('kryom.theme', 'dark')
    expect(systemPrefersLight()).toBe(false)
  })

  it('is false on a dark OS theme', () => {
    mockMatchMedia(false)
    expect(systemPrefersLight()).toBe(false)
  })
})

describe('initialTheme', () => {
  it('honours the OS light preference on first run', () => {
    mockMatchMedia(true)
    expect(initialTheme()).toBe('light')
  })

  it('prefers the stored theme over the OS preference', () => {
    mockMatchMedia(true)
    window.localStorage.setItem('kryom.theme', 'dark')
    expect(initialTheme()).toBe('dark')
  })

  it('defaults to dark otherwise', () => {
    mockMatchMedia(false)
    expect(initialTheme()).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('sets data-theme and persists the choice', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('kryom.theme')).toBe('light')
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('kryom.theme')).toBe('dark')
  })

  it('updates the theme-color meta tag when present', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
    applyTheme('light')
    expect(meta.getAttribute('content')).toBe('#f4f4f6')
    applyTheme('dark')
    expect(meta.getAttribute('content')).toBe('#101114')
  })

  it('applies cleanly without a theme-color meta tag', () => {
    expect(() => applyTheme('light')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('monacoTheme', () => {
  it('maps light to vs and dark to vs-dark', () => {
    expect(monacoTheme('light')).toBe('vs')
    expect(monacoTheme('dark')).toBe('vs-dark')
  })
})
