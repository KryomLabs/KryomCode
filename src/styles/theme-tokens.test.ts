// Stylesheet integrity tests: every custom property the app
// stylesheets consume must be defined, in both themes, and the
// files must stay brace-balanced. Regression cover for the
// tokenization pass that left 20+ --kc-* tokens referenced but
// undefined (transparent inputs, invisible hovers). Reads the real
// CSS sources from disk (the harness resolves `?raw` CSS imports to
// empty strings, so bundler imports cannot be trusted here); no
// CSSOM needed.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function load(name: 'app' | 'hero' | 'meta' | 'theme'): string {
  const file =
    name === 'app'
      ? 'app.css'
      : name === 'hero'
        ? 'hero.css'
        : name === 'meta'
          ? 'meta-ai.css'
          : 'theme.css'

  return readFileSync(join(HERE, file), 'utf8')
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function usedTokens(css: string, prefix: 'kc' | 'kryom'): Set<string> {
  const found = new Set<string>()
  const re =
    prefix === 'kc' ? /var\(--kc-([a-z-]+)\)?/g : /var\(--kryom-([a-z-]+)\)?/g
  for (const match of css.matchAll(re)) {
    found.add(match[1])
  }
  return found
}

function definedTokens(css: string, prefix: 'kc' | 'kryom'): Set<string> {
  const found = new Set<string>()
  const re =
    prefix === 'kc' ? /--kc-([a-z-]+)\s*:/g : /--kryom-([a-z-]+)\s*:/g
  for (const match of css.matchAll(re)) {
    found.add(match[1])
  }
  return found
}

const app = stripComments(load('app'))
const hero = stripComments(load('hero'))
const theme = stripComments(load('theme'))
const meta = stripComments(load('meta'))

describe('theme token integrity', () => {
  it('keeps every stylesheet brace-balanced', () => {
    for (const [name, css] of [
      ['app.css', app],
      ['hero.css', hero],
      ['theme.css', theme],
      ['meta-ai.css', meta],
    ] as const) {
      const open = (css.match(/\{/g) ?? []).length
      const close = (css.match(/\}/g) ?? []).length
      expect(`${name}: ${open} open vs ${close} close`).toBe(
        `${name}: ${open} open vs ${open} close`
      )
      expect(open).toBeGreaterThan(0)
    }
  })

  it('defines every --kc-* token the stylesheets use', () => {
    const used = new Set([
      ...usedTokens(app, 'kc'),
      ...usedTokens(hero, 'kc'),
      ...usedTokens(theme, 'kc'),
    ])
    const defined = new Set([
      ...definedTokens(app, 'kc'),
      ...definedTokens(theme, 'kc'),
    ])
    const missing = [...used].filter((token) => !defined.has(token))
    expect(missing).toEqual([])
    expect(used.size).toBeGreaterThan(20)
  })

  it('defines every --kryom-* token the stylesheets use', () => {
    const used = new Set([
      ...usedTokens(meta, 'kryom'),
      ...usedTokens(app, 'kryom'),
      ...usedTokens(theme, 'kryom'),
    ])
    const defined = new Set([
      ...definedTokens(meta, 'kryom'),
      ...definedTokens(theme, 'kryom'),
    ])
    const missing = [...used].filter((token) => !defined.has(token))
    expect(missing).toEqual([])
    expect(used.size).toBeGreaterThan(5)
  })

  it('overrides the full token set for the light theme', () => {
    const lightIde = theme.match(
      /html\[data-theme='light'\]\s*\.ide\s*\{([\s\S]*?)\}/
    )
    expect(lightIde).not.toBeNull()
    const lightKc = definedTokens(lightIde?.[1] ?? '', 'kc')
    // Every color token consumed anywhere must flip in the light
    // block. Layout constants (widths/heights) intentionally do
    // not: they are theme-independent by design.
    const layout = new Set([
      'activity-width',
      'titlebar-height',
      'statusbar-height',
    ])
    const consumed = new Set([
      ...usedTokens(app, 'kc'),
      ...usedTokens(hero, 'kc'),
      ...usedTokens(theme, 'kc'),
    ])
    const missing = [...consumed].filter(
      (token) => !layout.has(token) && !lightKc.has(token)
    )
    expect(missing).toEqual([])
  })

  it('keeps a light override for the Meta layer tokens', () => {
    // Several html-level light rules exist (base + Meta layer);
    // union every one of them before checking coverage.
    const lightRoots = [
      ...theme.matchAll(/html\[data-theme='light'\]\s*\{([\s\S]*?)\}/g),
    ]
    expect(lightRoots.length).toBeGreaterThan(0)
    const lightKryom = new Set(
      lightRoots.flatMap((block) => [...definedTokens(block[1], 'kryom')])
    )
    const consumed = usedTokens(meta, 'kryom')
    // Radius/gap/font/mono are theme-independent by design.
    const themed = [...consumed].filter(
      (token) => !['radius', 'gap', 'font', 'mono'].includes(token)
    )
    expect(themed.every((token) => lightKryom.has(token))).toBe(true)
  })
})
