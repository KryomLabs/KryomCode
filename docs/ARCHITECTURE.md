# KryomCode Architecture

Three processes, one trust direction. The renderer never touches the
disk, the network, or secrets. It calls typed methods on `window.kryom`;
the preload bridge forwards each call to exactly one main-process IPC
channel; the channel validates the sender and payload, then runs a
service. Only the human-readable error message travels back.

## Process map

```text
Renderer (React, sandboxed)        Preload              Main (Node + Electron)
───────────────────────────        ───────              ──────────────────────
src/app/App.tsx ──► kryom() ──► window.kryom ──► ipcRenderer.invoke ──► ipcMain.handle ──► service ──► disk / git / Meta API
src/api/kryom.ts      │                  │                        │
src/electron.d.ts ◄───┴── types ─────────┘                        └── trusted-sender + payload validation first
```

| Piece | Entry point | Runs where |
|---|---|---|
| Window + lifecycle | `electron/main.cjs` | Main |
| Capability bridge | `electron/preload.cjs` | Preload (no Node APIs) |
| Channel wiring | `electron/ipc/register-handlers.cjs` | Main |
| UI shell | `src/app/App.tsx` | Renderer |
| Typed bridge access | `src/api/kryom.ts`, `src/electron.d.ts` | Renderer |

## Main process

`electron/main.cjs` loads `.env` from the project root (development
only), registers all IPC handlers, creates the 1440x900 window, and
cleans up terminal and Git child processes on `before-quit`.
`loadApp` loads the Vite dev server when not packaged and falls back to
`dist/index.html`; packaged builds always load `dist/index.html`.
Navigation outside the dev server and `file:` URLs is denied, and new
windows are refused.

## IPC contract

Nine modules under `electron/ipc/`, one per domain. Every handler runs
`isTrustedSender(event)` (sender must be the app's own window, see
`electron/security/trusted-sender.cjs`) and then validates arguments
with `electron/security/validate-input.cjs` before calling a service.

| Channel | Direction summary |
|---|---|
| `workspace:open/close/refresh` | Native folder picker, tree rebuild |
| `workspace:read-file/save-file` | Whole-file read/write (existing files) |
| `filesystem:read-meta/save-conditional` | Read with mtime, write-if-unchanged |
| `filesystem:create/rename/delete` | Explorer mutations |
| `search:files` | Name or content search |
| `terminal:run/cancel/status` | One command per call, kill-all, list |
| `ai:chat` | Single chat completion |
| `agent:plan/apply` | Plan proposal, approved-edits apply |
| `git:status/diff/changed-files/stage/commit/push` | One channel per operation |
| `diagnostics:run` | One build/test command + parsed problems |
| `intelligence:summary/context` | Project summary + bounded context |
| `settings:get/update` | Validated preference store |
| `research:start/status/active/list/get/brief/cancel/resume/select` | Background research runs, persisted sessions, cited briefs |

The preload bridge (`electron/preload.cjs`) exposes one method per
channel plus read-only `platform` and `versions`. No channel accepts a
raw callback, path escape, or endpoint override.

## Services

`electron/services/` holds the domain logic as dependency-injected
CommonJS modules (`.cjs`, `require`/`module.exports`):

- `workspace/` — open-root state, containment checks, bounded tree.
- `filesystem/` — file read/write, directory mutations with conflict
  detection, bounded name/content search.
- `terminal/` — child-process runner, process registry, advisory
  command warnings.
- `ai/` — config allowlist, chat orchestration, provider interface,
  Meta implementation, deterministic mock for tests.
- `agent/` — plan validation and atomic apply with rollback.
- `git/` — status, diff, stage, commit, push over `git` on `PATH`.
- `diagnostics/` — command runner plus pure output parsers.
- `project-intelligence/` — summary, dependency analysis, AI context.
- `settings/` — preference store and the central secret allowlist.
- `research/` — search-provider abstraction (arXiv, OpenAlex,
  DuckDuckGo, optional Tavily), safe URL reader, session store under
  `.kryom/research/`, brief builder/validator, and the orchestrator.
  Chat and agent attach saved briefs via `researchSessionId`.

Cross-cutting helpers live in `electron/security/` (sender, path, and
input validation) and `electron/utils/` (coded errors, redacting
logger). See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for the
annotated file map and [SECURITY.md](SECURITY.md) for the boundaries
each layer enforces.
