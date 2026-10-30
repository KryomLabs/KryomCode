# Installing KryomCode

## Prerequisites

- **Node.js 22** (LTS line used by CI; `actions/setup-node`
  pins `node-version: '22'`). Older majors are untested.
- **npm** (ships with Node 22) — installs run through
  `npm ci` against the committed lockfile.
- **Git** — required for the Git panel and repository
  features; the editor works without it.
- Windows 10/11, macOS 13+, or a modern Linux desktop.
  See [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md) for the
  honest per-OS status: Windows is the validated platform;
  macOS/Linux packaging is configured but runtime testing
  there is pending owner hardware.

## From source (all platforms)

```powershell
git clone https://github.com/KryomLabs/kryomcode.git
cd kryomcode
npm ci
npm run dev
```

`npm run dev` starts the Vite renderer on
`http://127.0.0.1:5173` and opens the Electron shell
against it. The first launch opens the welcome screen;
open any folder as your workspace.

## From a release installer (when published)

No public installers are published yet. When they are,
download them only from the repository's **Releases**
page, verify the published checksums (see
[RELEASING.md](RELEASING.md)), and run the installer for
your platform. KryomCode never auto-installs updates:
in-app checks stage a verified download that you install
yourself.

## First-run configuration

1. Copy `.env.example` to `.env` and set `MODEL_API_KEY`
   (your Meta AI key). Never commit `.env`.
2. (Optional) Set `META_MODEL` (`muse-spark-1.3` default,
   `muse-wonder-1.0`) and `TAVILY_API_KEY` for Tavily web
   research.
3. Open Settings (gear icon) to pick the default model
   and confirm command-approval behavior.

Keys live in your environment only. Settings screens never
display them, and diagnostics exports never include them.

## Verifying the install

```powershell
npm test                 # full backend suite
npx tsc -b               # typecheck
npm run build            # production renderer
```

If anything fails, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md). To contribute,
continue with [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md).
