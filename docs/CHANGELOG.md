# KryomCode Changelog

All notable changes to this project. Dates use UTC. Entries follow the
repository history; the Unreleased section describes the current
working tree, which has not been committed yet.

## Unreleased

### Added

- Agent service and panel: JSON task plans with per-edit previews,
  selective apply, and atomic rollback (`agent:plan`, `agent:apply`).
- Git service and panel: status, diff, changed files, stage, commit,
  push (`git:*` channels).
- Diagnostics service and Problems panel: one-command runs with
  TypeScript, generic, and Node-stack parsers (`diagnostics:run`).
- Project intelligence: workspace summary and bounded AI context
  (`intelligence:summary`, `intelligence:context`).
- Settings service and modal: validated `defaultModel` and
  `aiContextEnabled` persisted to Electron user data
  (`settings:get`, `settings:update`).
- Terminal status and cancellation channels (`terminal:status`,
  `terminal:cancel`) and a process registry.
- Filesystem meta/conditional channels with mtime conflict detection
  (`filesystem:read-meta`, `filesystem:save-conditional`).
- File and folder create/rename/delete channels plus name/content
  search (`filesystem:*`, `search:files`).
- Full frontend shell: Explorer, Search, Monaco editor, AI Chat,
  Agent, Terminal, Problems, Git, Settings, dialogs, status bar.
- Meta provider (`muse-spark-1.3`, `muse-wonder-1.0`), provider
  interface, and deterministic mock provider.
- Central secret allowlist, redacting logger, coded errors,
  trusted-sender and input-validation guards.
- Backend test suite: 15 `node:test` files plus the wiring regression
  test, run by `npm test`.
- Syntax gate (`npm run check:syntax`) over all backend files.
- Windows CI workflow (`.github/workflows/ci.yml`): install, test,
  syntax check, production build.
- Windows packaging: electron-builder NSIS configuration with
  `npm run pack` (unpacked dir) and `npm run dist` (installer).
- Documentation set: README, `docs/` guides, and limitation records.

### Changed

- `.env` handling: project-root dotenv load in development, user
  environment variable for packaged builds; `.env.example` holds
  placeholders only.
- Production renderer entry resolves to `dist/index.html` with a
  relative Vite base for `file://` loading.

### Removed

- 34 zero-byte scaffold files (misspelled IPC duplicate, unused
  security/services/frontend/style stubs, empty root configs).
- Obsolete empty directory trees (`src/features/`, `tests/`,
  `public/assets/`, `public/icons/`).
- `tsconfig.tsbuildinfo` removed from version control (still
  Git-ignored build output).

### Security

- Renderer sandbox (`contextIsolation`, no `nodeIntegration`), new
  windows denied, navigation allowlisted.
- Every IPC channel requires the app's own window as sender and
  validates its payload.
- Workspace containment with symlink rejection on all path operations.
- API key confined to the main process; scrubbed from child
  environments and logs.

## 2026-10-27 — Foundation (committed history)

- `e324f7a` Initialize kryomcode workspace.
- `a1bb4cc` Add Electron desktop runtime.
- `d11c19e` Add project explorer and Monaco editor.
- `8bd8947` Fix Electron workspace and terminal handlers.
- `e3b4ab2` Add kryomcode project README.
- `d2d9a21` Add MIT license.
- `f29e6d3` Correct workspace path validation.
- `e6fd724` Add kryomcode AI Chat foundation.
- `93791a8` Organize project structure.
- `f8be2d0` Modularize Electron backend services.
- `8baac87` Fix clone URL case sensitivity in README.
