// Localization core (Level 4B.7). English-only today by explicit
// choice: shipped locales must be human-complete, so other locales
// stay pending instead of machine-translated.
//
// - getLocale(): stored preference → navigator prefix match → 'en'.
// - t(key, vars?): typed lookup with {name} interpolation; unknown
//   keys render the key itself (loud fallback, never blank).
// - setLocale(): validates, persists, notifies useLocale hooks.
// - formatNumber/formatDate(): Intl with the active locale.
// - Code, file contents, terminal output, and user-authored text are
//   NEVER translated — only chrome strings go through t().
import { useSyncExternalStore } from 'react'
import { en, type LocaleKey } from './locales/en'

export const SUPPORTED_LOCALES = ['en'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export type { LocaleKey }

const STORAGE_KEY = 'kryom.locale'
const LOCALE_EVENT = 'kryom:locale'

const tables: Record<SupportedLocale, Record<LocaleKey, string>> = { en }

function storedLocale(): SupportedLocale | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
      return raw as SupportedLocale
    }
  } catch {
    // Storage unavailable (privacy mode): fall through to detection.
  }

  return null
}

function detectedLocale(): SupportedLocale {
  try {
    const tags = window.navigator.languages?.length
      ? window.navigator.languages
      : [window.navigator.language]

    for (const tag of tags) {
      const prefix = String(tag || '').split('-')[0]?.toLowerCase()

      if (prefix && (SUPPORTED_LOCALES as readonly string[]).includes(prefix)) {
        return prefix as SupportedLocale
      }
    }
  } catch {
    // Detection unavailable: default below.
  }

  return 'en'
}

export function getLocale(): SupportedLocale {
  return storedLocale() ?? detectedLocale()
}

export function setLocale(next: string): SupportedLocale {
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(next)
    ? (next as SupportedLocale)
    : 'en'

  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Persist best-effort; the in-memory value still applies below.
  }

  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: locale }))

  return locale
}

function subscribeLocale(listener: () => void): () => void {
  const handler = () => listener()

  window.addEventListener(LOCALE_EVENT, handler)

  return () => window.removeEventListener(LOCALE_EVENT, handler)
}

export function translate(locale: SupportedLocale, key: string, vars?: Record<string, string | number>): string {
  const table = tables[locale] ?? tables.en
  const template: string = (table as Record<string, string>)[key] ?? key

  if (!vars) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] === undefined ? match : String(vars[name])
  )
}

export function t(key: LocaleKey, vars?: Record<string, string | number>): string {
  return translate(getLocale(), key, vars)
}

export function useLocale(): { locale: SupportedLocale; t: (key: LocaleKey, vars?: Record<string, string | number>) => string } {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale)

  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
  }
}

export function formatNumber(value: number, locale?: SupportedLocale): string {
  try {
    return new Intl.NumberFormat(locale ?? getLocale()).format(value)
  } catch {
    return String(value)
  }
}

export function formatDate(value: string | number | Date, locale?: SupportedLocale): string {
  try {
    return new Intl.DateTimeFormat(locale ?? getLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

export function localeLabel(locale: SupportedLocale): string {
  // Endonyms: each locale names itself in its own language.
  const names: Record<SupportedLocale, string> = { en: 'English' }

  return names[locale] ?? locale
}
