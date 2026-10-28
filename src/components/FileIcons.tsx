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

export function FileIcon() {
  return (
    <Glyph
      label="File"
      d={[
        'M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z',
        'M13 3v5h6',
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
