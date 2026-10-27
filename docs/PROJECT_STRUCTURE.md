# KryomCode Project Structure

Annotated map of the repository. Generated from the actual tree after
the Phase 3 scaffold cleanup; empty placeholder directories were
removed.

```text
kryomcode/
├── electron/                    # Main process (CommonJS, .cjs only)
│   ├── main.cjs                 # App lifecycle, window, .env load, loadApp
│   ├── preload.cjs              # window.kryom capability bridge
│   ├── wiring.test.cjs          # Module/export/require regression net
│   ├── ipc/                     # One register module per domain
│   │   ├── register-handlers.cjs
│   │   ├── workspace.ipc.cjs    # workspace:open/close/refresh
│   │   ├── filesystem.ipc.cjs   # read/save/meta/conditional/create/rename/delete, search:files
│   │   ├── terminal.ipc.cjs     # terminal:run/cancel/status
│   │   ├── ai.ipc.cjs           # ai:chat
│   │   ├── agent.ipc.cjs        # agent:plan/apply
│   │   ├── git.ipc.cjs          # git:status/diff/changed-files/stage/commit/push
│   │   ├── diagnostics.ipc.cjs  # diagnostics:run
│   │   ├── project-intelligence.ipc.cjs  # intelligence:summary/context
│   │   └── settings.ipc.cjs     # settings:get/update
│   ├── security/
│   │   ├── trusted-sender.cjs   # Own-window check for every channel
│   │   ├── validate-path.cjs    # Workspace containment, symlink rejection
│   │   ├── validate-input.cjs   # Payload guards (objects, strings, enums)
│   │   └── security.test.cjs    # Security unit tests
│   ├── services/
│   │   ├── workspace/           # Root state, isInsideWorkspace, buildTree (+test)
│   │   ├── filesystem/          # file.service, directory.service, file-search.service (+tests)
│   │   ├── terminal/            # terminal.service, process-manager, command-validator (+test)
│   │   ├── ai/                  # ai.service, ai-config.service (+tests),
│   │   │   └── providers/       # provider.interface, meta-muse.provider (+test), mock.provider
│   │   ├── agent/               # agent.service: planTask, applyEdits (+test)
│   │   ├── git/                 # git.service, git-diff.service (+test)
│   │   ├── diagnostics/         # diagnostics.service, problem-parser (+test)
│   │   ├── project-intelligence/ # project-analyzer.service, dependency-analyzer.service (+test)
│   │   └── settings/            # settings.service (+test), secrets.service (MODEL_API_KEY allowlist)
│   └── utils/                   # errors.cjs (coded errors), logger.cjs (redacting) (+test)
├── src/                         # Renderer (React + TypeScript)
│   ├── main.tsx                 # React root, imports styles/app.css
│   ├── electron.d.ts            # KryomAPI + payload/response interfaces
│   ├── vite-env.d.ts            # Vite client types
│   ├── api/kryom.ts             # kryom() bridge accessor, errorMessage, isWriteConflict
│   ├── app/App.tsx              # IDE shell: layout, editor state, saves, dialogs
│   ├── components/              # One panel per file (see below)
│   ├── styles/app.css           # Single global stylesheet (do not split)
│   └── utils/                   # diff.ts (line diff), languages.ts, paths.ts
├── scripts/
│   └── check-backend-syntax.cjs # node --check gate over electron/**/*.cjs
├── docs/                        # This documentation set
├── .github/workflows/ci.yml     # Windows CI: npm ci, test, syntax, build
├── public/                      # Vite static assets (served as-is)
├── index.html                   # Renderer entry (root div + /src/main.tsx)
├── vite.config.ts               # React plugin, relative base './' for file:// builds
├── tsconfig.json                # Strict TS, bundler resolution, include src only
├── package.json                 # Scripts, deps, electron-builder "build" config
├── package-lock.json            # Reproducible installs (npm ci in CI)
├── .env.example                 # Placeholder-only env template (copy to .env)
├── .editorconfig                # 2-space, LF, trim whitespace
├── .gitignore                   # Dependencies, build output, secrets, release dirs
├── LICENSE                      # MIT (KryomLabs, 2026)
└── README.md                    # User-facing overview and commands
```

## Renderer components (`src/components/`)

| File | Export | Backend channels used |
|---|---|---|
| `Explorer.tsx` | `Explorer` | create/delete/rename via `App.tsx` handlers |
| `SearchPanel.tsx` | `SearchPanel` | `searchFiles` |
| `EditorPanel.tsx` | `EditorPanel` | None directly (Monaco view; `App.tsx` saves) |
| `AiChat.tsx` | `AiChat` | `askAI`, `getWorkspaceContext` |
| `AgentPanel.tsx` | `AgentPanel` | `planAgentTask`, `applyAgentEdits`, `readFileMeta` (diff baseline) |
| `TerminalPanel.tsx` | `TerminalPanel` | `runCommand`, `cancelCommand`, `getTerminalStatus` |
| `ProblemsPanel.tsx` | `ProblemsPanel` | `runDiagnostics` |
| `GitPanel.tsx` | `GitPanel` | `gitStatus`, `gitDiff`, `gitStage`, `gitCommit`, `gitPush` |
| `SettingsModal.tsx` | `SettingsModal` | `getSettings`, `updateSettings` |
| `Chrome.tsx` | `TopBar`, `StatusBar` | None (pure layout) |
| `dialogs.tsx` | `DialogProvider`, `useDialogs` | None (confirm/prompt/conflict dialogs) |

`src/app/App.tsx` owns workspace state, the open editor buffer, save
and conflict flows, and explorer mutations; panels own only their own
UI state. All backend calls go through `kryom()` from `src/api/kryom.ts`
so a missing bridge fails loudly.

Two bridge methods are exposed, covered by the wiring test, but not
currently called by the UI: `readFile` (the UI reads through
`readFileMeta` instead) and `gitChangedFiles` (the UI derives file
lists from `gitStatus`). They remain part of the documented preload
contract.

## Conventions

- Backend files are CommonJS with the `.cjs` extension because
  `package.json` sets `"type": "module"`.
- Backend tests are colocated (`*.test.cjs` next to the module) and run
  with the Node test runner; see [TESTING.md](TESTING.md).
- `dist/`, `release/`, `out/`, and `node_modules/` are build artifacts
  and stay out of Git.
