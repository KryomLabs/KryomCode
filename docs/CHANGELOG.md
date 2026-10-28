# KryomCode Changelog

All notable changes to this project. Dates use UTC. Entries follow the
repository history; the Unreleased section describes the current
working tree, which has not been committed yet.

## Unreleased

### Added

- Close guard: dirty editor tabs prompt Save/Discard/Cancel on window
  close (native dialog, sequential save-all with nonce settlement) and
  a generic prompt on reload; clean windows close without prompts
  (`file.saveAll` command, `dirtyCount` in `ui:context`).
- Monaco inline diagnostics: Problems results map to gutter markers
  with F8/Shift+F8 navigation and stale-marker cleanup.
- Git unstage (`git:unstage`) and discard-tracked (`git:discard`)
  operations with tests; Git panel reflowed to a single sidebar
  column with per-section selection.
- Research findings, evidence, decisions, verification, and
  implementation tasks rendered with source citations; sources open
  in the system browser via validated `app:open-external`.
- Safe dependency-free message rendering: fenced code blocks with
  Copy, headings, lists, quotes, inline code; message Copy buttons;
  brief shown as structured content instead of raw text.
- AI key pre-flight: Welcome, Chat, and Agent show inline setup
  guidance with a Connections shortcut instead of failing blind.
- Terminal command history (Up/Down, deduped) and an auto-scroll
  toggle; input row wraps at narrow widths.
- Editor tabs: roving-tabindex arrow/Home/End navigation, focus
  restore on close, scroll-into-view, Ctrl+Tab cycling.
- Keyboard Shortcuts dialog (Help menu) listing only wired commands.
- Right-side Terminal/Output panel (resizable, persisted, Ctrl+`)
  replacing the bottom dock; Chat/Agent/Research stay on the center
  stage, Git/Problems in the sidebar.
- GitHub Connections: verified remote checks, remote listing,
  clone-and-open, fast-forward pull (`git:remotes`, `git:verify`,
  `git:clone`, `git:pull`).
- Local Word workflows: research-brief and text export to .docx with
  numbered citations, .docx import, report scaffolds
  (`documents:*` channels; `docx`, `mammoth`).
- Desktop IDE shell: native File/Edit/Selection/View/Go/Run/Terminal/
  Help menu, activity bar, contextual sidebar, center editor/AI stage,
  right-side Terminal/Output panel, and live status bar.
- Center staging: Chat, Agent, and Research stay mounted on the
  center stage with full session state; Git and Problems live in the
  sidebar without remounting.
- Go to File quick-open palette (Ctrl+P) with fuzzy matching over the
  workspace tree; Go to Line, Back/Forward history, and Open Recent.
- File menu operations: New Text File, Open File, Open Folder,
  Open Recent, Save, Save As, Auto Save, Close Editor, Close
  Folder. New Window is disabled: the backend workspace root is a
  process-wide singleton until roots are scoped per window.
- Connections, Extensions, Profile, and Output views; About dialog;
  extended Settings (model, auto-save, editor font size, panel
  sizes); status-bar diagnostics summary; terminal Clear.
- Backend: `workspace:open-file`, `workspace:open-path`,
  `filesystem:save-as`, `app:get-version`, `app:get-ai-status`,
  `app:open-external`, `ui:get`/`ui:set`/`ui:context` channels;
  ui-state service with auto-save and recent projects.
- Recent projects prune entries whose folders no longer exist, with
  the menu and welcome list updated.
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
