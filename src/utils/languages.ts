// Maps file names to Monaco language identifiers. Unknown extensions
// fall back to plaintext, which Monaco also does for unknown ids.

const EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  scala: 'scala',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  xml: 'xml',
  svg: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
}

const FILENAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
}

export function detectLanguage(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  const lower = base.toLowerCase()
  const special = FILENAMES[lower]

  if (special) {
    return special
  }

  const dot = lower.lastIndexOf('.')

  if (dot === -1) {
    return 'plaintext'
  }

  return EXTENSIONS[lower.slice(dot + 1)] ?? 'plaintext'
}
