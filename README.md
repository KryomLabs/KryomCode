# KryomCode

Research → Understand → Plan → Review → Execute → Verify

KryomCode is an open-source, Meta-first, review-first desktop coding
workspace. It connects research and AI-assisted development to real
code changes and verified results while keeping developers in
control: it combines a project explorer, multi-tab Monaco editor,
integrated terminal, Git tools, build diagnostics, and a Meta AI
chat, agent, and research panel in one Electron app.

The developer stays in control: the agent only proposes plans, every
file edit needs explicit approval before it is applied, and terminal,
Git, and file operations each require an explicit user action.

> Prerelease status: KryomCode is at version 0.1.0 with the Level 4B
> implementation complete in this repository. This README describes
> only what is implemented here. Anything planned, externally
> blocked, or still needing a manual check is called out under
> [Limitations](#limitations),
> [Roadmap](#roadmap), and in
> [docs/backend-limitations.md](docs/backend-limitations.md).
> No installers are published yet: there are no releases on the
> [Releases page](https://github.com/KryomLabs/kryomcode/releases),
> so install from source or build an installer locally.

## Why KryomCode?

Research usually dies in browser tabs: papers get read, then the
implementation starts from a blank file with no trace back to the
evidence. KryomCode keeps the whole chain in one workspace —
research with cited sources, source-grounded plans, diff review,
explicit approval, then verified execution — so every change can be
traced back to the research and checks behind it.

## Current development status

- Backend services, IPC channels, and the security boundary are
  implemented (`electron/`).
- The React frontend panels and bridge wiring are implemented (`src/`).
- The backend is covered by an automated `node:test` suite (71 test
  files run by `npm test`), a renderer DOM suite
  (`npm run test:renderer`), a syntax gate
  (`npm run check:syntax`), a renderer-state gate
  (`npm run check:workbench`), a test-manifest gate
  (`npm run check:test-manifest`), and a 3-OS CI matrix
  (Windows/macOS/Linux) that also runs the production build and the
  unpacked-app pack checks.
- Last executed runs on the owner Windows machine (2026-10-30):
  `npm test` → 637 tests, 632 pass, 0 fail, 5 environment-skipped;
  `npm run test:renderer` → 8/8; `tsc`, syntax, manifest,
  workbench, build, pack, `check:release`, and `dist` gates all
  green. See [docs/TESTING.md](docs/TESTING.md) and
  [docs/FINAL_RELEASE_REPORT.md](docs/FINAL_RELEASE_REPORT.md).
- Packaging configuration (electron-builder) exists for Windows
  (NSIS), macOS (dmg), and Linux (AppImage, deb), with branded
  icons in `assets/branding/` and a release-contents gate
  (`npm run check:release`). Only the Windows build has been
  executed; macOS/Linux packaging is configured but untested.
- Manual end-to-end checks (packaged-app launch and install, GUI
  walkthrough, real-key AI requests) are tracked in
  [docs/TESTING.md](docs/TESTING.md) and
  [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md); see
  [docs/backend-limitations.md](docs/backend-limitations.md) for the
  verification record. Re-run the smoke list before each release and
  do not treat packaged-app or cross-platform checks as done until
  they have actually been run.

## Screenshots

No verified screenshots are checked into the repository yet. To add
them: launch the app with `npm run dev`, capture the AI Workspace
welcome view and one real chat/agent/research session (redact any
personal paths or keys), save the files under `docs/images/`, and
reference them from this section. Do not link screenshots that do
not exist in the repo.

## Key features

### AI Chat

- Chat with Meta AI models from the center-stage Chat view.
- Per-request model picker (`muse-spark-1.3` or `muse-wonder-1.0`).
- Optional workspace context: the active file (with unsaved changes)
  or a bounded project summary is attached as labelled reference
  material.
- Conversation history persists per project (`.kryom/chat.json`) and
  survives restarts.
- Stop button cancels the in-flight request; prompts are capped at
  12,000 characters and the last 12 messages are sent as history.
- When no API key is configured, inline setup guidance is shown
  instead of failing blind.

### AI Agent and approval-based file editing

- Describe a coding task; the agent returns a JSON plan of file edits
  (at most 20 edits and 10 suggested commands).
- Each edit is previewed as a diff with full content available, and
  edits are selected individually for approval.
- Apply writes only the approved edits, re-validating every path, and
  rolls back the batch if any edit fails.
- Planning can be cancelled with the Stop button. Planned commands are
  suggestions only: the agent has no execution path and never runs
  them.
- Research sessions can be handed to the agent via
  "Implement from Research".
- Proposals are tracked as schema-v2 records under `.kryom/plans/`
  with risks, expected outcomes, step states, evidence links, and
  persisted verification reports; interrupted steps are flagged,
  never silently completed.
- Every apply persists pre-apply bytes under `.kryom/checkpoints/`
  (last 10 kept) with per-item Undo from the agent panel.

### Provider platform and model routing

- A descriptor contract with a deterministic provider registry;
  duplicate registration is rejected.
- An honest model catalog: capabilities, context limits, and
  availability stay unknown until confirmed, never invented
  (streaming is reported as unsupported because the provider is
  single-shot).
- Centralized routing with explicit-only fallback: the app never
  silently switches providers or models.
- Provider selection is stored without secrets; API keys stay in the
  environment allowlist or the OS-encrypted vault and never cross
  IPC. See [docs/PROVIDER_GUIDE.md](docs/PROVIDER_GUIDE.md).

### Project workspace and file explorer

- Open a folder with the native picker, open a single file, reopen
  recent projects (max 8), or clone a repository and open it.
- Bounded file tree (2,000 entries, depth 8). `node_modules`, `.git`,
  build output, and symlinks are excluded.
- Create, rename, and delete files and folders from the explorer.
- Name and content search with result caps (200 results; files over
  100 KB are skipped for content search; `.env*` files are excluded).

### Monaco code editor and file saving

- Multi-file tabs with dirty tracking, keyboard navigation,
  focus restore on close, and session restore (tabs plus unsaved
  edits reopen after reload or relaunch).
- Saves use mtime-based conflict detection: if a file changed on
  disk, a dialog offers reload-from-disk or overwrite.
- Save As to a new location, optional Auto Save, and a window close
  guard (native Save/Discard/Cancel prompt when tabs are dirty).
- Files are capped at 1 MB for reading and writing.
- The editor is bundled locally with its language workers, styles,
  and fonts: the production build loads no remote editor assets.
  The live offline check is a manual step in
  [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md).
- Diagnostics from the Problems panel appear as gutter markers with
  F8/Shift+F8 navigation.

### Integrated terminal

- Run one command per explicit invocation in the project folder.
- Advisory destructive-pattern warnings (for example `rm -rf`,
  `rd /s`, disk format, `git reset --hard`). Warnings are metadata,
  never a safety verdict.
- Destructive commands face a native main-process approval dialog
  that the renderer cannot skip; a Settings toggle can require
  confirmation for every command.
- Commands time out after 120 seconds, output is capped at 100 KB,
  and running processes can be cancelled or listed.
- Command history (Up/Down recall), auto-scroll toggle, and Clear.
- Child processes receive a secret-scrubbed environment.

### Research with sources and citations

- Research a technical topic through real search providers: arXiv,
  OpenAlex, and DuckDuckGo need no key; Tavily web results are
  optional with `TAVILY_API_KEY`.
- Runs progress through visible steps (planning, searching, papers,
  reading, comparing, synthesizing, brief) and can be cancelled or
  resumed.
- Sessions and cited markdown briefs persist in the project under
  `.kryom/research/`.
- Every `[n]` citation must resolve to a retrieved source; briefs
  that fail validation fall back to an extractive brief that only
  quotes sources and never invents claims. Without an LLM key,
  research produces the extractive brief directly.
- Sources open in the system browser. Briefs can be attached to chat
  ("Ask about this"), handed to the agent ("Implement from
  Research"), or exported to `.docx`.

### Git workflows

- Sidebar Source Control view: status (staged, unstaged,
  untracked), diffs, stage, unstage, discard of tracked changes
  (with confirmation), commit, push, and fast-forward-only pull.
- Connections view: remote listing, remote verification with
  `git ls-remote`, and clone-and-open.
- Clone targets are restricted to GitHub HTTPS/SSH repository URLs
  or existing local folders.
- Push and pull use your ambient Git credentials; KryomCode never
  asks for, stores, or transmits them.

### Diagnostics and developer tools

- Run one build or test command from the Problems panel (suggests
  `npm run build` or `npm run test` when those scripts exist) and
  browse parsed problems.
- Parsers cover TypeScript output, generic `file:line:col` output,
  and Node stack traces (at most 200 diagnostics). Success means
  exit code 0 with no timeout.
- Every verification run is classified into failure categories with
  quoted file/line/test evidence, persisted on the report and fed
  into repair prompts. There is no automatic repair.
- Project summary (project type, detected configs, scripts, bounded
  file index) and a bounded AI context snapshot.
- Local Word-compatible document workflows: research-brief and text
  export to `.docx`, plus `.docx` import.
- Native menu (File, Edit, Selection, View, Go, Run, Terminal,
  Help), Go to File quick-open with fuzzy matching, Go to Line,
  Keyboard Shortcuts dialog, and a live status bar.
- Settings persist in the Electron user-data folder: default model,
  AI context toggle, editor font size, panel sizes, Auto Save, and
  recent projects. Secrets are never stored in settings.

### Project intelligence and quality

- A persistent fingerprinted code index (incremental refresh,
  staleness reporting, budgeted ranked context), a JS/TS
  symbol/reference index, deterministic semantic project search with
  explained scores, relative-import impact analysis with quoted
  evidence, and evidence-backed architecture analysis.
- The index is exposed over `intelligence:*` channels; nothing is
  uploaded to providers by default and stale entries are reported,
  never silently used.
- Computed regression analysis, test suggestions for uncovered
  changed symbols, a deterministic security pattern scan with quoted
  evidence, and persisted reports with an explainable verdict — no
  invented percentages.
- An INTEL center-stage tab hosts search, impact, architecture,
  planning, specialist runs, orchestration runs with per-task
  approval, and quality reports.

### Updates and diagnostics export

- The Updates tab checks a strict https feed schema on demand,
  downloads into staging with progress and cancellation, and
  verifies sha512 before reporting the staged path. Users install
  manually; failures clear staging and the running install is never
  modified. No feed URL is configured yet.
- Help → Export Diagnostics previews a redacted bundle (versions,
  platform, status counts, `~` paths, error one-liners) and writes a
  user-chosen local file. Nothing uploads.

### Extensions, skills, workflows, and integrations

- Extensions install from local folders only (no marketplace, no
  remote registry, no auto-activation): strict manifest validation,
  disabled-by-default installs, a vm-sandboxed runtime with
  timeouts, and process isolation with crash recovery. A TypeScript
  SDK lives in `sdk/` with a working `examples/hello-command/`
  sample. See [docs/EXTENSION_GUIDE.md](docs/EXTENSION_GUIDE.md).
- Skills bind reusable definitions to a fixed tool catalog with
  permission mapping (4 built in); workflows run versioned
  explicit advance/approve/resume/cancel with bounded retries and
  persisted history (5 built in). See
  [docs/SKILLS_WORKFLOWS.md](docs/SKILLS_WORKFLOWS.md).
- A shared integrations adapter contract ships with a local-git
  GitHub adapter (repositories, branches, remotes, history; PRs and
  issues are explicitly unsupported). Tokens never reach the
  renderer, logs, or AI context. See
  [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- Project templates generate preview-before-confirm with
  path-traversal rejection and atomic staging (3 tested starters);
  setup commands are returned as instructions and never executed.
  See [docs/TEMPLATES.md](docs/TEMPLATES.md).
- 12 granular permissions with no wildcard, explicit user grants,
  trust levels that never auto-grant, enforcement at the execution
  boundary, and a secret-free audit log.

## Technology stack

| Technology | Purpose |
|---|---|
| Electron 45 | Desktop shell, main process, IPC |
| React 19 + TypeScript 5.7 | Renderer UI |
| Vite 6 | Dev server and production renderer build |
| Monaco Editor | Code editing (locally bundled `monaco-editor` + `@monaco-editor/react`, no CDN) |
| Node.js test runner | Backend tests (`node:test`, no framework) |
| Vitest + Testing Library | Renderer DOM tests (`npm run test:renderer`) |
| electron-builder 26 | Packaging (Windows NSIS, macOS dmg, Linux AppImage + deb) |
| dotenv | Local `.env` loading in development |
| docx, mammoth | `.docx` export and import |

## Architecture overview

Three layers with one trust direction. The renderer never touches the
disk, the network, or secrets.

```text
Renderer (React, sandboxed)      Preload            Main (Node + Electron)
src/app/App.tsx ──► kryom() ──► window.kryom ──► ipcMain.handle ──► service ──► disk / git / Meta API
src/api/kryom.ts         │              │
src/electron.d.ts ◄──────┴── types ─────┘
```

| Piece | Location | Runs where |
|---|---|---|
| Window + lifecycle | `electron/main.cjs` | Main |
| Capability bridge | `electron/preload.cjs` (~150 typed methods) | Preload (no Node APIs) |
| Channel wiring | `electron/ipc/register-handlers.cjs` + 15 domain modules | Main |
| UI shell | `src/app/App.tsx` | Renderer |
| Typed bridge access | `src/api/kryom.ts`, `src/electron.d.ts` | Renderer |

- `electron/main.cjs` loads `.env` from the project root in
  development, registers all IPC handlers, creates the 1440x900
  window, and kills terminal and Git child processes on quit.
  Unpackaged builds load the Vite dev server with a `dist/index.html`
  fallback; packaged builds serve `dist/` over the private
  `kryom://app` scheme.
- Every IPC handler first checks that the sender is the app's own
  window (`electron/security/trusted-sender.cjs`) and validates its
  payload (`electron/security/validate-input.cjs`). Only
  human-readable error messages travel back to the renderer.
- `electron/preload.cjs` exposes one typed method per channel plus
  read-only `platform` and `versions`. No Node APIs, file system
  access, or secrets are exposed.
- Domain logic lives in `electron/services/`: `workspace`,
  `filesystem`, `terminal`, `ai` (config, orchestration, providers,
  routing, catalog), `agent`, `git`, `diagnostics`,
  `project-intelligence`, `settings` (preferences, secret allowlist,
  credential vault), `research`, `documents`, `ui`, `memory`,
  `planning`, `specialists`, `orchestration`, `quality`,
  `permissions`, `audit`, `extensions`, `skills`, `workflows`,
  `integrations`, `templates`, `platform`, `release`, `context`,
  and `crash`.
- All path operations resolve through workspace containment, which
  rejects traversal outside the open root and refuses symlinks.
- The repository is `"type": "module"`, so backend files use the
  `.cjs` extension with `require`/`module.exports`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for details.

## Project structure

```text
kryomcode/
├── electron/               # Main process (CommonJS .cjs)
│   ├── main.cjs            # Window, lifecycle, protocol, menus
│   ├── preload.cjs         # window.kryom capability bridge
│   ├── menu.cjs            # Native application menu
│   ├── ipc/                # 15 domain channel modules + register-handlers
│   ├── security/           # Trusted sender, CSP, protocol, path/input guards
│   ├── services/           # workspace, filesystem, terminal, ai, agent,
│   │                       # git, diagnostics, project-intelligence,
│   │                       # settings, research, documents, ui, memory,
│   │                       # planning, specialists, orchestration, quality,
│   │                       # permissions, audit, extensions, skills,
│   │                       # workflows, integrations, templates, platform,
│   │                       # release, context, crash
│   └── utils/              # Logger, errors, shared helpers
├── src/                    # Renderer (React + TypeScript)
│   ├── app/App.tsx         # Shell: activity bar, sidebar, center, panels
│   ├── api/kryom.ts        # Typed bridge accessor
│   ├── electron.d.ts       # Bridge + shared IPC types
│   ├── components/         # Panels (chat, agent, research, editor, …)
│   ├── state/              # Renderer state (tabs, sessions, history)
│   ├── test/               # Vitest setup for the DOM suite
│   ├── styles/app.css      # Dark theme + design tokens
│   └── utils/              # Paths, tabs, languages, Monaco setup
├── sdk/                    # Extension SDK types (API v1)
├── examples/hello-command/ # Working sample extension
├── docs/                   # Architecture, testing, smoke test, roadmap
├── scripts/                # Syntax, manifest, workbench, release gates
├── assets/branding/        # Logo and generated platform icons
├── index.html              # Renderer entry
└── package.json            # Scripts, deps, electron-builder config
```

## Prerequisites

- Node.js 22 or newer (continuous integration pins Node 22 to match
  the Electron 45 runtime). Download from
  [nodejs.org](https://nodejs.org/).
- Git, available on `PATH` (required by the Git panel; the editor
  works without it).
- npm, included with Node.js.
- A Meta API key, for the AI chat, agent, and LLM research-synthesis
  features only. Everything else works without one.

## Supported platforms

| Use | Windows | macOS | Linux |
|---|---|---|---|
| Development (`npm run dev`, `npm test`) | Windows 10/11 x64, Node 22 | Should work, not run yet | Should work, not run yet |
| Packaged app (`npm run pack*`) | Unpacked dir, executed | dmg config, untested | AppImage + deb config, untested |
| Installer (`npm run dist*`) | NSIS, executed (unsigned) | dmg config, untested | AppImage + deb config, untested |
| CI (`.github/workflows/ci.yml`) | `windows-latest`, Node 22 | `macos-latest`, prepared | `ubuntu-latest`, prepared |

The code handles all three platforms (paths, shells, process trees,
executable lookup, app-data dirs), but only Windows has been
validated by execution. The 3-OS CI matrix is configured; its first
macOS/Linux runs are still pending. macOS/Linux packaging targets
are configured but no installer has been built or launched there.
See the honest matrix in
[docs/PLATFORM_SUPPORT.md](docs/PLATFORM_SUPPORT.md).

## Installation

No installers are published yet, so there is nothing to download.
Install from source:

```powershell
git clone https://github.com/KryomLabs/kryomcode.git
cd kryomcode
npm ci
npm run dev
```

To build an installer locally instead, see
[docs/BUILDING.md](docs/BUILDING.md) and
[docs/RELEASING.md](docs/RELEASING.md):

```powershell
npm run dist          # Windows NSIS installer -> release/
npm run dist:mac      # macOS dmg (unsigned until certs exist)
npm run dist:linux    # Linux AppImage + deb
```

Local installers are unsigned and show the operating system's
standard unknown-publisher warnings. When public installers exist,
they will be published only on the repository's
[Releases page](https://github.com/KryomLabs/kryomcode/releases)
with checksums.

## Environment configuration

AI features read their configuration from the main-process
environment. For local development, copy the template and fill in
your own key:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

- `MODEL_API_KEY` (required for AI chat, agent, and LLM brief
  synthesis): your Meta API key. You can also store it in the
  OS-encrypted vault from Settings → Providers; the environment
  value wins when both exist.
- `META_MODEL` (optional): `muse-spark-1.3` (default) or
  `muse-wonder-1.0`.
- `TAVILY_API_KEY` (optional): enables Tavily web results in
  Research. Built-in providers (arXiv, OpenAlex, DuckDuckGo) need no
  key, and research without an LLM key produces an extractive brief.

The integration itself does not document how Meta issues API keys;
the `.env.example` template points at Meta's model documentation for
model details. Paste the key value you already have into `.env`.

Rules:

- Never commit `.env`. It is Git-ignored (`.env` and `.env.*`),
  `.env.example` holds placeholders only, and packaged builds
  exclude `.env` files.
- Never commit `.kryom/`. It holds private per-project state (chat
  history, research sessions, plans, checkpoints) and is Git-ignored;
  it must stay untracked in every clone. A dedicated test fails the
  suite if `.kryom/` becomes tracked.
- The key never leaves the main process: it is not exposed to the
  renderer, terminal children, logs, or packaged settings. Only key
  presence (booleans) crosses the bridge.
- After changing `.env`, restart `npm run dev`.
- Installed (packaged) builds have no `.env` file. Set
  `MODEL_API_KEY` as a user environment variable instead, then start
  KryomCode.

## Supported models

| Model ID | Notes |
|---|---|
| `muse-spark-1.3` | Default model for chat, agent, research synthesis, and settings. |
| `muse-wonder-1.0` | Selectable via `META_MODEL`, settings, or per-request override. |

Model selection is an allowlist enforced in
`electron/services/ai/ai-config.service.cjs`. Unknown IDs are
rejected with an error that lists the supported values. Requests go
to the fixed endpoint `https://api.meta.ai/v1/chat/completions`
(temperature `0.2`, 90-second timeout), which is not configurable.
Routing never falls back silently: without an explicitly configured
standby, an unusable provider fails with an error instead of
switching models behind your back.
See [docs/API_INTEGRATION.md](docs/API_INTEGRATION.md).

## Commands

All commands run from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | Starts Vite on `http://127.0.0.1:5173`, then launches Electron against it. |
| `npm test` | Runs the backend test suite (71 test files, `node:test`). |
| `npm run test:renderer` | Runs the renderer DOM suite (`vitest`; run `npm install` first). |
| `npm run check:syntax` | Byte-checks every `electron/**/*.cjs` file with `node --check`. |
| `npm run check:test-manifest` | Fails when a `*.test.cjs` file is missing from the `test` script. |
| `npm run check:workbench` | Runs the pure renderer-state gate (tabs, sessions, registries). |
| `npm run check:release` | Verifies the unpacked `npm run pack` output (layout, asar, exclusions). |
| `npm run build` | Type-checks (`tsc -b`) and builds the renderer to `dist/`. |
| `npm run preview` | Serves the production `dist/` build locally with Vite. |
| `npm run pack` | Builds the renderer and produces an unpacked Windows app in `release/`. |
| `npm run pack:mac` | Builds the renderer and produces an unpacked macOS app in `release/`. |
| `npm run pack:linux` | Builds the renderer and produces an unpacked Linux app in `release/`. |
| `npm run dist` | Builds the renderer and produces a Windows NSIS installer in `release/`. |
| `npm run dist:mac` | Builds the renderer and produces a macOS dmg in `release/`. |
| `npm run dist:linux` | Builds the renderer and produces Linux AppImage + deb in `release/`. |
| `npm run dist:preview` | Builds a Windows installer with the baked `preview` channel. |

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`,
`npm test`, `npm run check:syntax`, `npm run check:test-manifest`,
`npm run check:workbench`, a typecheck, a committed-secret scan, a
production-dependency audit, and `npm run build` on
Windows/macOS/Linux for pushes and pull requests to `main`, plus a
per-OS `pack` job that builds and verifies the unpacked app. A
manual-dispatch release workflow (`.github/workflows/release.yml`)
builds and validates installer candidates without publishing. CI
uses no secrets.

## Basic usage

- Open a project: launch with `npm run dev`, then use Open Project
  in the Explorer panel (or File > Open Folder), pick a recent
  project, or clone a repository from the Connections view.
- Chat: open the center-stage Chat view, pick a model, optionally
  toggle workspace context, type a prompt, and send. Use Stop to
  cancel a slow request. "Ask about this" on a research brief
  attaches that brief as cited context.
- Agent: open the Agent view, describe the task, and request a plan.
  Review each edit's diff, select the edits you approve, then Apply.
  Only approved edits are written; planned commands are never run
  automatically, so copy any you want into the terminal after
  reviewing them.
- Approve file edits: approval is the set of edits you select before
  pressing Apply. The backend re-validates every edit and rolls the
  batch back if one fails.
- Terminal: open the Terminal panel, type a command, review any
  destructive-pattern warnings, confirm when asked, and run it.
  Cancel stops running processes; output arrives on completion.
- Research: open the Research view, enter an objective, and start.
  Watch the step list, then read the cited brief, open sources in
  the browser, export to `.docx` if needed, or continue with "Ask
  about this" / "Implement from Research".
- Git: open the Source Control tab for status,
  diffs, stage/unstage, discard, commit, push, and pull. Verify
  remotes and clone from the Connections view.
- Diagnostics: open the Problems tab, confirm or
  edit the suggested command, and run it. Click a problem to jump
  to its file and line; markers support F8/Shift+F8 navigation.
- Keyboard shortcuts used above are also listed in the app's Help >
  Keyboard Shortcuts dialog.

## Demo flow (about 5 minutes)

A consistent script for recordings. Use a disposable project and a
configured `MODEL_API_KEY`:

1. **Open** — `npm run dev`, then Open Project in the Explorer panel.
2. **Research** — Research view, objective "retry strategies for
   flaky network calls", Start research; show the cited brief.
3. **Context** — Agent view: check Include active file, Search + Add
   one file.
4. **Plan** — task "Add a one-line comment at the top of hello.js
   explaining what it does", Plan task; show the context preview.
5. **Review** — read one Why rationale and its diff; note the
   never-executed command list.
6. **Approve** — keep one edit checked, Apply approved edits, confirm.
7. **Verify** — Verification section: show the working directory and
   the exact command, Run check, confirm, show the exit code.

The full release gate (save conflicts, stale plans, failing checks,
offline editor, `.kryom` hygiene) is the separate checklist in
[docs/SMOKE_TEST.md](docs/SMOKE_TEST.md).

## Security considerations

- The renderer is sandboxed (`contextIsolation`, no
  `nodeIntegration`, `sandbox: true`) and talks to the main process
  only through the validated `window.kryom` bridge in
  `electron/preload.cjs`. New windows are denied; navigation is
  restricted to the exact dev-server origin in development and the
  `kryom://app` entry document in packaged builds (`file:` URLs are
  denied), and the content security policy allows no remote hosts.
- Every IPC channel checks that the sender is the app's own window
  and validates its payload before acting.
- All file, terminal, Git, diagnostics, and agent operations are
  contained to the open workspace. Symlinks are rejected, and reads
  and writes are capped at 1 MB per file.
- Terminal commands run with your OS user permissions. Warnings are
  advisory only: a command without warnings is not certified safe.
  Review every command, especially agent-suggested ones.
- Only open project folders you trust. Git uses standard ancestor
  discovery, so a folder inside another repository reports that
  repository's state.
- Treat AI output as untrusted: review each planned edit before
  approving, and never paste secrets into prompts.
- Extension, skill, workflow, and integration actions are gated by
  the 12-capability permission platform with a secret-free audit
  log; hostile third-party code stays outside the supported threat
  model.
- Report suspected vulnerabilities privately to the KryomLabs
  maintainers instead of filing a public issue. See
  [docs/SECURITY.md](docs/SECURITY.md).

## Limitations

Current limits of the implementation:

- Files are capped at 1 MB; the file tree, search, and indexes are
  bounded and report truncation.
- Terminal and diagnostics output arrive on completion; there is no
  mid-run streaming view, and chat answers are single-shot (no
  streaming).
- Agent planning and apply batches can both be cancelled (Stop
  buttons); a cancelled apply keeps completed edits and writes a
  checkpoint, while failures roll back.
- Diagnostics parsers cover TypeScript, generic `file:line:col`,
  and Node stack formats only.
- Git push and pull use your ambient Git credentials; KryomCode
  never asks for or stores them.
- Only one window is supported: New Window is disabled because the
  backend workspace root is a process-wide singleton.
- Installers are unsigned and there are no automatic updates; the
  updater only stages verified downloads for manual install, and no
  update feed is configured.
- Only Windows builds have been executed; macOS/Linux packaging is
  configured but untested, and the first 3-OS CI runs are pending.
- The running-app GUI walkthrough (`docs/SMOKE_TEST.md`) still needs
  a display session.
- There is no extension marketplace: extensions install from local
  folders only, by design.
- The UI is dark-theme only; there is no light theme.

Planned ideas (not implemented, not promised) are listed in
[docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md); the Level 3C/4A/4B
gate records with per-item verification status live in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Roadmap

Genuine future work, in the order it unblocks a public release. None
of this is scheduled or promised; items that need hardware, money,
or credentials the repository does not have are marked blocked:

1. Run the GUI walkthrough in [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)
   on a display session (Windows first).
2. Execute the first 3-OS CI matrix runs and record the results.
3. Build, launch, and smoke-test the macOS dmg and Linux
   AppImage/deb on real hardware (blocked: test machines).
4. Obtain a Windows signing certificate and Apple notarization, then
   ship signed installers (blocked: certificates).
5. Host the update feed and configure `KRYOM_UPDATE_FEED` (blocked:
   hosting).
6. Product ideas from [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md)
   (streaming output, more diagnostics parsers, light theme): ideas
   only, no commitments.

No new roadmap milestones are being added; the Level 3C → 4A → 4B
structure in `docs/ROADMAP.md` is preserved as-is.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `Meta API key is not configured...` | `.env` is missing, the key is empty, or the app was not restarted after editing it. Packaged builds need the `MODEL_API_KEY` user environment variable. |
| `Meta API authentication failed...` | Wrong or revoked key. Check `MODEL_API_KEY` and try again. |
| `Meta API rate limit reached...` | Too many requests. Wait a moment and try again. |
| `Invalid META_MODEL...` / `Unsupported model...` | Only `muse-spark-1.3` and `muse-wonder-1.0` are accepted. Fix the value and restart. |
| `Open a project folder first.` | No workspace is open. Open or clone a project first. |
| `File is outside the selected workspace.` | Absolute path outside the root, or a symlink (rejected by design). Copy the target into the workspace. |
| `Git is not installed or not on PATH.` | Install Git for your platform, make sure it is on `PATH`, and restart the app. |
| `The selected folder is not a Git repository.` | Git panel used outside a repo. Note that Git discovers ancestor repositories. |
| Blank window on `npm run dev` | Dev server not up and no `dist/` build to fall back to. Run `npm run build` once, then retry. |
| `Desktop bridge is unavailable.` | Page loaded outside Electron (for example a plain browser tab). Run the app with `npm run dev`. |

## Contributing

1. Fork the repository and create a feature branch.
2. Keep backend code in CommonJS (`.cjs`) and renderer code in
   TypeScript. Match the existing 2-space, no-semicolon,
   single-quote style (see `.editorconfig`).
3. New IPC channels go in `electron/ipc/<domain>.ipc.cjs`, are wired
   in `register-handlers.cjs`, must call `isTrustedSender(event)`
   first, and need matching `electron/preload.cjs` plus
   `src/electron.d.ts` entries.
4. Add or update a colocated `*.test.cjs` test for backend changes
   and append it to the `test` script in `package.json` (the suite
   lists files explicitly, and tests must use no real keys or
   network). Add renderer tests under `src/**/*.test.{ts,tsx}` for
   UI behavior changes.
5. Never log prompts, file contents, keys, or headers. Use
   `createLogger` from `electron/utils/logger.cjs`.
6. Run `npm test`, `npm run test:renderer`, `npm run check:syntax`,
   `npm run check:test-manifest`, and `npm run build`.
7. Open a pull request against `main` describing the change and the
   manual checks you ran.

Report bugs and request features through the repository's Issues
tab. Include the KryomCode version (Help > About), the OS
version, and the exact steps to reproduce; never paste API keys,
`.env` contents, or private `.kryom` data into an issue.
Vulnerabilities go through private Security Advisories only —
see [SECURITY.md](SECURITY.md).

The full process (gates, docs, security review, commit style)
lives in [CONTRIBUTING.md](CONTRIBUTING.md); behavior
expectations in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md);
data handling in [PRIVACY.md](PRIVACY.md).

See [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) for
workflows and [docs/TESTING.md](docs/TESTING.md) for test
conventions and the manual-check list.

Detailed references live in `docs/`:

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — processes, IPC, data flow.
- [PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) — annotated file map.
- [DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) — workflows and tips.
- [SECURITY.md](docs/SECURITY.md) — boundaries and secret handling.
- [API_INTEGRATION.md](docs/API_INTEGRATION.md) — Meta provider details.
- [PROVIDER_GUIDE.md](docs/PROVIDER_GUIDE.md) — provider platform and routing.
- [EXTENSION_GUIDE.md](docs/EXTENSION_GUIDE.md) — extension manifest, runtime, walkthrough.
- [SKILLS_WORKFLOWS.md](docs/SKILLS_WORKFLOWS.md) — skills catalog and workflow engine.
- [INTEGRATIONS.md](docs/INTEGRATIONS.md) — adapter contract and GitHub adapter.
- [TEMPLATES.md](docs/TEMPLATES.md) — template authoring and generation.
- [PLATFORM_API.md](docs/PLATFORM_API.md) — versioned public API reference.
- [INSTALLATION.md](docs/INSTALLATION.md) — prerequisites and first run.
- [DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) — daily commands and conventions.
- [BUILDING.md](docs/BUILDING.md) — production builds and packaging.
- [RELEASING.md](docs/RELEASING.md) — versioning, channels, release checklist.
- [PLATFORM_SUPPORT.md](docs/PLATFORM_SUPPORT.md) — honest per-OS matrix.
- [THREAT_MODEL.md](docs/THREAT_MODEL.md) — threats, controls, residual risks.
- [SECURITY_ARCHITECTURE.md](docs/SECURITY_ARCHITECTURE.md) — how the controls are built.
- [PRIVACY.md](docs/PRIVACY.md) — privacy implementation reference.
- [DEPENDENCIES.md](docs/DEPENDENCIES.md) — supply-chain policy and inventory.
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common failures and fixes.
- [FAQ.md](docs/FAQ.md) — short answers.
- [TESTING.md](docs/TESTING.md) — test inventory and manual checks.
- [SMOKE_TEST.md](docs/SMOKE_TEST.md) — GUI release-gate checklist.
- [FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md) — done vs planned.
- [ROADMAP.md](docs/ROADMAP.md) — milestone gate records (3B/3C/4A/4B).
- [CHANGELOG.md](docs/CHANGELOG.md) — release history.
- [FINAL_RELEASE_REPORT.md](docs/FINAL_RELEASE_REPORT.md) — final audit and release readiness.
- [backend-limitations.md](docs/backend-limitations.md) — verified limits.

## License

KryomCode is licensed under the MIT License. See
[LICENSE](LICENSE) for details.

## Project links

- Repository: [github.com/KryomLabs/kryomcode](https://github.com/KryomLabs/kryomcode)
- Issues: [github.com/KryomLabs/kryomcode/issues](https://github.com/KryomLabs/kryomcode/issues)
- Releases: [github.com/KryomLabs/kryomcode/releases](https://github.com/KryomLabs/kryomcode/releases)
  (no installers published yet — check here after the first release)

## Hackathon context

KryomCode is entered in the Meta Global AI Developer Hackathon 2026,
Indie Developer (Individual/Solo) track. It is an independent project
by KryomLabs that integrates Meta AI models through their API; this
does not imply official endorsement by, or affiliation with, Meta.
