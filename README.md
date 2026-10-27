# KryomCode

KryomCode is an AI-assisted desktop coding workspace. It combines a project
explorer, a Monaco code editor, an integrated terminal, Git tools, build
diagnostics, and a Meta AI chat and agent panel in one Electron app. The
developer stays in control: AI plans are previewed before anything is
applied, and terminal, Git, and file operations each require an explicit
user action.

> Early development: KryomCode is under active development. The sections
> below describe only what is implemented in this repository. Anything
> still requiring a manual check is listed under Limitations.

## Current capabilities

- Open a local project folder and browse it in a bounded file tree.
- Edit one file at a time in Monaco, with dirty tracking and
  save-conflict detection (reload from disk or overwrite).
- Create, rename, and delete files and folders from the explorer.
- Search by file name or file content with result caps.
- Run terminal commands in the project folder, with advisory
  destructive-pattern warnings, cancellation, and status.
- Chat with Meta AI models, with optional workspace context and a
  per-request model override.
- Plan multi-file coding tasks with the agent, preview each edit as a
  diff, then apply only the approved edits (atomic, with rollback).
- Inspect Git status and diffs, stage, commit, and push from the Git panel.
- Run a build or test command and browse parsed problems (TypeScript,
  generic `file:line:col`, and Node stack formats).
- View a project summary (type, frameworks, scripts, configs) and a
  bounded AI context snapshot.
- Persist UI preferences (default model, AI context toggle) in the
  Electron user-data folder.

## Technology stack

| Technology | Purpose |
|---|---|
| Electron 45 | Desktop shell, main process, IPC |
| React 19 + TypeScript 5.7 | Renderer UI |
| Vite 6 | Dev server and production renderer build |
| Monaco Editor | Code editing (`@monaco-editor/react`) |
| Node.js test runner | Backend tests (`node:test`, no framework) |
| electron-builder 26 | Windows packaging (NSIS) |
| dotenv | Local `.env` loading in development |

## Prerequisites (Windows development)

- Node.js 22 or newer (CI uses Node 22; local development was last run
  on Node 24). Download from [nodejs.org](https://nodejs.org/).
- Git for Windows, available on `PATH` (required by the Git panel).
- npm, included with Node.js.
- A Meta API key, for the AI chat and agent features only. Everything
  else works without one.

## Installation and local development

```powershell
git clone https://github.com/KryomLabs/kryomcode.git
cd kryomcode
npm install
npm run dev
```

`npm run dev` starts the Vite dev server on `http://127.0.0.1:5173` and
then launches the Electron shell against it.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the backend test suite (15 test files). |
| `npm run check:syntax` | Byte-compiles every `electron/**/*.cjs` file. |
| `npm run build` | Type-checks (`tsc -b`) and builds the renderer to `dist/`. |
| `npm run pack` | Builds the renderer and produces an unpacked Windows app in `release/`. |
| `npm run dist` | Builds the renderer and produces a Windows NSIS installer in `release/`. |

## Environment variables

AI features read their configuration from the main process environment.
For local development, copy the template and fill in your own key:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

- `MODEL_API_KEY` (required for AI chat and agent): your Meta API key.
- `META_MODEL` (optional): `muse-spark-1.3` (default) or
  `muse-wonder-1.0`.

Rules:

- Never commit `.env`. It is Git-ignored; `.env.example` holds
  placeholders only.
- The key never leaves the main process: it is not exposed to the
  renderer, terminal children, logs, or packaged settings.
- After changing `.env`, restart `npm run dev`.
- Installed (packaged) builds have no `.env` file. Set `MODEL_API_KEY`
  as a Windows user environment variable instead, then start KryomCode.

## Supported models

| Model ID | Notes |
|---|---|
| `muse-spark-1.3` | Default model for chat, agent, and settings. |
| `muse-wonder-1.0` | Selectable via `META_MODEL`, settings, or per-request override. |

Model selection is an allowlist enforced in
`electron/services/ai/ai-config.service.cjs`. Unknown IDs are rejected
with an error that lists the supported values. Requests go to the fixed
endpoint `https://api.meta.ai/v1/chat/completions` with a 90-second
timeout. See [docs/API_INTEGRATION.md](docs/API_INTEGRATION.md).

## Tests and builds

```powershell
npm test             # backend suite, must be green before a PR
npm run check:syntax # fast static gate over electron/**/*.cjs
npm run build        # tsc + Vite production build into dist/
```

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`,
`npm run check:syntax`, and `npm run build` on Windows for pushes and
pull requests to `main`. CI uses no secrets.

## Limitations and manual verification

Current limits of the implementation:

- One file is open in the editor at a time. Files are capped at 1 MB.
- Terminal and diagnostics output arrive on completion; there is no
  mid-run streaming view.
- Agent planning has no mid-plan cancel (apply can be cancelled between
  edits and keeps approved work done so far).
- Diagnostics parsers cover TypeScript, generic `file:line:col`, and
  Node stack formats only.
- Git push uses your ambient Git credentials; KryomCode never asks for
  or stores them.
- Packaging targets Windows only (NSIS installer plus unpacked dir).

Manual checks still required (not yet performed by the maintainers):

1. Launch the Electron app with `npm run dev` and walk the panels.
2. Run one real-key AI request per model and confirm the answers.
3. Run `npm run pack`, launch the unpacked app, and confirm the `dist/`
   fallback, settings storage, and env-var key pickup.
4. Run `npm run dist` and install the NSIS installer on a clean machine.

Do not claim these verifications until they have actually been run. See
[docs/backend-limitations.md](docs/backend-limitations.md) and
[docs/TESTING.md](docs/TESTING.md).

## Security

- The renderer is sandboxed (`contextIsolation`, no `nodeIntegration`)
  and talks to the main process only through the validated `window.kryom`
  bridge in `electron/preload.cjs`.
- Every IPC channel checks that the sender is the app's own window and
  validates its payload before acting.
- All file, terminal, Git, and agent operations are contained to the
  open workspace. Symlinks are rejected.
- Terminal commands run with your OS user permissions. Warnings are
  advisory only: a command without warnings is not certified safe.
- Report suspected vulnerabilities privately to the KryomLabs
  maintainers instead of filing a public issue. See
  [docs/SECURITY.md](docs/SECURITY.md).

## Contributing

1. Fork the repository and create a feature branch.
2. Keep backend code in CommonJS (`.cjs`) and renderer code in
   TypeScript. Match the existing 2-space, no-semicolon style.
3. Add or update a colocated `*.test.cjs` test for backend changes.
4. Run `npm test`, `npm run check:syntax`, and `npm run build`.
5. Open a pull request against `main` describing the change and the
   manual checks you ran.

## Project status

- Phase 1 (backend services, IPC, security, tests): implemented.
- Phase 2 (React frontend panels and bridge wiring): implemented.
- Phase 3 (hygiene, docs, CI, Windows packaging): in progress in this
  working tree; the live-launch and real-key checks above are still open.

Detailed references live in `docs/`:

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — processes, IPC, data flow.
- [PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) — annotated file map.
- [DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) — workflows and tips.
- [SECURITY.md](docs/SECURITY.md) — boundaries and secret handling.
- [API_INTEGRATION.md](docs/API_INTEGRATION.md) — Meta provider details.
- [TESTING.md](docs/TESTING.md) — test inventory and manual checks.
- [FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md) — done vs planned.
- [CHANGELOG.md](docs/CHANGELOG.md) — release history.
- [backend-limitations.md](docs/backend-limitations.md) — verified limits.

## License

KryomCode is licensed under the MIT License. See
[LICENSE](LICENSE) for details.
