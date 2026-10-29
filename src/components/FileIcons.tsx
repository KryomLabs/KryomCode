// Small monochrome file-tree icon set in the same 24x24 stroke style
// as the Activity Bar. currentColor keeps them neutral; no emoji.

function Glyph({ d, label }: { d: string[]; label: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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

export function FolderIcon() {
  return (
    <Glyph
      label="Folder"
      d={[
        'M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
      ]}
    />
  )
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'rb', 'java',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'swift', 'kt', 'php',
  'scala', 'lua', 'pl', 'r', 'vue', 'svelte',
])

const DATA_EXTENSIONS = new Set([
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'csv', 'ini', 'cfg',
])

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'rst', 'adoc', 'log',
])

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')

  if (dot < 0 || dot === name.length - 1) {
    return ''
  }

  return name.slice(dot + 1).toLowerCase()
}

// File glyph with a small type mark (code brackets, data braces,
// text lines, image frame) so file kinds are recognizable at a
// glance while staying in the monochrome stroke set.
export function FileIcon({ name }: { name?: string }) {
  const extension = name ? extensionOf(name) : ''

  let mark: string[]

  if (CODE_EXTENSIONS.has(extension)) {
    mark = ['M9.5 9.5L7 12l2.5 2.5', 'M14.5 9.5L17 12l-2.5 2.5']
  } else if (DATA_EXTENSIONS.has(extension)) {
    mark = ['M10 9.5A1.5 1.5 0 0 0 8.5 12 1.5 1.5 0 0 0 10 14.5', 'M14 9.5a1.5 1.5 0 0 1 1.5 2.5A1.5 1.5 0 0 1 14 14.5']
  } else if (TEXT_EXTENSIONS.has(extension)) {
    mark = ['M9 10h6M9 12.5h6M9 15h4']
  } else if (IMAGE_EXTENSIONS.has(extension)) {
    mark = ['M7 15l3.5-4 2.5 3 1.5-2L17 15', 'M9.5 9.5h.01']
  } else {
    mark = []
  }

  return (
    <Glyph
      label="File"
      d={[
        'M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z',
        'M13 3v5h6',
        ...mark,
      ]}
    />
  )
}

export function NewFileIcon() {
  return (
    <Glyph
      label="New file"
      d={[
        'M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z',
        'M13 3v5h6',
        'M12 11v6M9 14h6',
      ]}
    />
  )
}

export function NewFolderIcon() {
  return (
    <Glyph
      label="New folder"
      d={[
        'M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
        'M12 11v6M9 14h6',
      ]}
    />
  )
}

export function RefreshIcon() {
  return (
    <Glyph
      label="Refresh"
      d={[
        'M20 12a8 8 0 1 1-2.3-5.6',
        'M20 3v4h-4',
      ]}
    />
  )
}

export function OpenFolderIcon() {
  return (
    <Glyph
      label="Open project"
      d={[
        'M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
        'M9 13l2 2 4-4',
      ]}
    />
  )
}

export function PencilIcon() {
  return (
    <Glyph
      label="Rename"
      d={[
        'M4 20l1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 0l1.5 1.5a1.8 1.8 0 0 1 0 2.5L9 20z',
        'M14.5 6.5l3 3',
      ]}
    />
  )
}

export function TrashIcon() {
  return (
    <Glyph
      label="Delete"
      d={[
        'M4 7h16',
        'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
        'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13',
      ]}
    />
  )
}
