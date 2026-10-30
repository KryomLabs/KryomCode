# Development Setup

## One-time setup

```powershell
git clone https://github.com/KryomLabs/kryomcode.git
cd kryomcode
npm ci
copy .env.example .env   # then fill in MODEL_API_KEY
```

Requirements: Node.js 22, npm, Git. See
[INSTALLATION.md](INSTALLATION.md).

## Daily commands

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Vite + Electron with hot reload |
| `npm test` | Full backend suite (Node test runner, 69 files) |
| `node --test <one file>` | One focused suite |
| `npm run check:syntax` | `node --check` over `electron/**/*.cjs` |
| `npm run check:test-manifest` | Every `*.test.cjs` listed in `package.json` |
| `npx tsc -b` | TypeScript project build |
| `npm run build` | Typecheck + production renderer to `dist/` |
| `npm run pack` | Unpacked Windows app to `release/` |
| `npm run check:release` | Validate the packed app |

## Repository conventions

- Backend is CommonJS (`.cjs`) under `electron/` —
  services own logic, `electron/ipc/*.ipc.cjs` own
  channels, `register-handlers.cjs` wires them.
- Tests colocate (`foo.test.cjs` next to `foo.cjs`) and
  must be added to the `test` script or the manifest
  gate fails.
- Renderer is React + TypeScript under `src/`; backend
  calls go through `kryom()` only.
- Never `console.log` secrets; use `utils/logger.cjs`
  (auto-redacting). Never invent test results, model
  capabilities, or platform support in docs.

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| `MODEL_API_KEY` | Meta AI provider key (required for AI) |
| `META_MODEL` | Model override (optional) |
| `TAVILY_API_KEY` | Tavily web research (optional) |
| `KRYOM_CHANNEL` | `preview` forces preview env in packaged builds (ops override) |
| `KRYOM_UPDATE_FEED` | Update feed URL override (no default) |
| `KRYOM_LOG_LEVEL` | `error` / `warn` / `info` (default `info`) |
| `KRYOM_DEVTOOLS` | `1` allows DevTools in packaged builds |

`.env` loads in development only; packaged builds ignore
it. See [BUILDING.md](BUILDING.md) and
[RELEASING.md](RELEASING.md) for the production side.
