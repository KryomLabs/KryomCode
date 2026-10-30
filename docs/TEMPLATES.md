# KryomCode Template Guide

How project templates are defined, previewed, and
generated.

## Layout

```
my-template/
├── template.json     # manifest (templateVersion: 1)
└── files/            # walked recursively, at most 100 files
    ├── index.html
    └── {{project_name}}.config
```

`template.json`:

```json
{
  "templateVersion": 1,
  "id": "basic-web",
  "name": "Basic Web Application",
  "description": "...",
  "version": "1.0.0",
  "category": "frontend",
  "language": "JavaScript",
  "framework": "None",
  "runtime": "Any static server or browser",
  "variables": [
    { "name": "project_name", "description": "Site title",
      "default": "my-site", "required": true,
      "pattern": "[a-z0-9-]+" }
  ],
  "setup": {
    "instructions": "Open index.html in a browser.",
    "commands": ["npx serve ."]
  }
}
```

- At most 30 variables; names match `[a-zA-Z0-9_]{1,60}`.
- `pattern` constrains values; missing required values
  without defaults fail loudly.
- `setup.commands` are **instructions only** — the
  engine returns them and never executes them.

## Substitution

`{{name}}` placeholders in file contents and file paths
are replaced with resolved values; `\{{` escapes to a
literal. Unresolved placeholders fail with their names.

## Generation flow

1. `template:preview` renders everything and reports
   `files` plus `collisions` (existing files that would
   be overwritten). Nothing is written.
2. `template:generate` writes only when there are no
   collisions, or when the caller passes
   `confirmed: true` after showing the preview.

Safety:

- Destination must be absolute with an existing parent.
- Traversal outside the destination is rejected, for
  both contents and substituted paths.
- Fresh directories write through staging + rename
  (atomic); confirmed overwrites write directly and
  report exactly what was overwritten.
- Caps: 100 files, 1 MB per file, 10 MB total.

## Shipped templates

`basic-web` (zero-dependency static site),
`node-typescript`, `react-vite` — each tested. Add new
ones only with tests; untested templates do not ship.
