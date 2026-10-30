# KryomCode Development Guide

Day-to-day workflows for working on KryomCode itself. For the file map
see [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md); for the test
inventory see [TESTING.md](TESTING.md).

## First run

```powershell
npm install
Copy-Item .env.example .env   # then add MODEL_API_KEY for AI features
npm run dev
```

`npm run dev` runs Vite on `http://127.0.0.1:5173` and launches Electron
once the server answers. If the dev server is unreachable, the window
falls back to `dist/index.html` and logs a warning.

## Before every pull request

```powershell
npm test                    # backend suite (see TESTING.md), must be green
npm run check:syntax        # node --check over electron/**/*.cjs
npm run check:test-manifest # every *.test.cjs listed in the test script
npm run check:workbench     # pure renderer-state gate (tabs, sessions, registry, timeline, intent, history relevance)
npm run test:renderer     # renderer DOM suite (vitest; needs npm install first)
npm run build               # tsc -b + vite build into dist/
```

CI runs the same gates on Windows with a clean `npm ci`, plus a
production-dependency audit (`npm audit --omit=dev
--audit-level=high`, fails on high/critical) and a separate `pack`
job that runs `npm run pack` followed by `npm run check:release`
(unpacked layout, asar contents, and secret/test exclusions).

## Dependency audit

Triage process when the audit gate fails:

1. Upgrade the affected dependency (`npm update <name>` or a
   version bump) and re-run the audit.
2. If no fixed release exists, assess exploitability in KryomCode's
   usage (main-process only vs renderer-reachable) and note it in
   the pull request.
3. Temporary exceptions (advisory id, why it cannot be fixed yet,
   review date) go in the list below; each exception expires and
   must be re-audited by its review date.

Known audit exceptions: none.

## Backend conventions

- CommonJS with the `.cjs` extension (`electron/**/*.cjs`). The repo is
  `"type": "module"`, so `.js` would parse as ESM and break `require`.
- Services export plain functions or classes and validate every
  argument; renderer input is untrusted even after IPC validation.
- New IPC channels go in `electron/ipc/<domain>.ipc.cjs`, are wired in
  `register-handlers.cjs`, and must call `isTrustedSender(event)` first.
- New bridge methods go in `electron/preload.cjs` plus matching
  TypeScript declarations in `src/electron.d.ts`.
- Colocate tests as `<module>.test.cjs` and add the file to the `test`
  script in `package.json` (the suite lists files explicitly).
- Never log prompts, file contents, keys, or headers. Use
  `createLogger` from `electron/utils/logger.cjs`, which redacts
  secret-shaped keys and `Bearer` values.
- Style: 2 spaces, no semicolons, single quotes. `.editorconfig`
  encodes the basics.

## Frontend conventions

- All backend calls go through `kryom()` in `src/api/kryom.ts`. Use
  `errorMessage()` for display text and `isWriteConflict()` for the
  save-conflict dialog.
- `src/app/App.tsx` owns workspace and editor state. Panels own only
  their local UI state and report status through `onStatus`.
- Styling lives in the global stylesheets (`src/styles/app.css` plus
  the Level 3C `src/styles/meta-ai.css` layer). Do not reintroduce
  per-component stylesheets without discussion.
- The unified tab model (`src/state/workbench-tabs.ts`) and Meta AI
  sessions (`src/state/meta-sessions.ts`) are pure modules covered by
  `npm run check:workbench`; keep them dependency-free.
- `src/electron.d.ts` is the contract: if the UI needs a new bridge
  method, add the preload method, the `KryomAPI` declaration, and the
  IPC channel together.

## Environment and settings

- Development keys live in the project-root `.env` (Git-ignored).
  `electron/main.cjs` loads it with dotenv at startup.
- `META_MODEL` selects the default model; unknown values fail fast with
  the supported list.
- User preferences persist to `kryomcode-settings.json` in the Electron
  `userData` directory. Unknown or corrupt files fall back to defaults.
- Packaged builds have no `.env`: the key comes from the user's own
  entry in Settings → Providers (OS-encrypted vault) or from the
  `MODEL_API_KEY` user environment variable. See the README.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Meta API key is not configured` | No vault key and no env key. Add one in Settings → Providers, or set `.env` and restart. |
| `Open a project folder first` | No workspace is open; use Open Project. |
| `Path is outside the selected workspace` | Absolute path outside the root, or a symlink. |
| `Symbolic links are not followed` | By design; copy the target into the workspace. |
| `Git is not installed or not on PATH` | Install Git for Windows and restart the app. |
| `The selected folder is not a Git repository` | Git panel used outside a repo (note: Git discovers ancestor repos). |
| Blank window on `npm run dev` | Dev server not up and no `dist/` build; run `npm run build` once. |
| `Desktop bridge is unavailable` | Page loaded outside Electron (e.g. plain browser preview). |
| Tests fail with `ECONNREFUSED` | A test tried the network; AI tests use the mock provider, check edits. |
