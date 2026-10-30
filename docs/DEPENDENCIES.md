# Dependencies and Supply Chain

## Direct dependencies (installed versions, 2026-10-30)

Runtime:

| Package | Version | License | Used for |
| ------- | ------- | ------- | -------- |
| `react`, `react-dom` | 19.3.1 | MIT | Renderer UI |
| `monaco-editor` | 0.57.0 | MIT | Editor (bundled locally, offline) |
| `@monaco-editor/react` | 4.7.0 | MIT | React bindings for Monaco |
| `docx` | 9.15.0 | MIT | Research brief export |
| `mammoth` | 1.13.0 | BSD-2-Clause | `.docx` import |
| `dotenv` | 18.0.9 | BSD-2-Clause | Dev-only `.env` load |
| `undici` | 7.30.1 | MIT | HTTP (research fetch, update feed) |

Development:

| Package | Version | License | Used for |
| ------- | ------- | ------- | -------- |
| `electron` | 45.0.0 | MIT | Desktop shell |
| `electron-builder` | 26.18.0 | MIT | Packaging/installers |
| `vite` | 6.4.5 | MIT | Dev server + renderer build |
| `@vitejs/plugin-react` | 4.7.0 | MIT | React fast refresh |
| `typescript` | 5.9.3 | Apache-2.0 | Typechecking |
| `concurrently`, `wait-on` | 10.0.6 / 9.5.1 | MIT | `npm run dev` orchestration |
| `@types/react`, `@types/react-dom` | 19.x | MIT | Types |

All permissive and compatible with the project's MIT
license. Notable transitive pin: `dompurify >= 3.4.17`
(MPL-2.0 OR Apache-2.0, pulled by monaco) is floored via
`overrides` with a regression test in
`electron/security/security.test.cjs`; it is not imported
by KryomCode code directly.

## Policy

- **Lockfile is law.** `package-lock.json` is committed;
  installs and CI use `npm ci`. A PR that changes
  dependencies must include the lockfile diff.
- **Minimal set.** No new dependency without PR
  justification: existing code was evaluated first, the
  license is permissive, and the package is maintained.
- **No blind upgrades.** Patch/minor bumps go through
  the normal PR + gates flow; major bumps need a
  compatibility note (Electron majors especially:
  check `BrowserWindow` options, `utilityProcess`, and
  asar behavior).
- **Vulnerability response.** `npm audit --omit=dev
  --audit-level=high` runs in CI. On a finding:
  identify the affected package, confirm it is actually
  loaded (directly or transitively — `npm ls <pkg>`),
  patch or override to the fixed range, rerun the gates.
  A clean scanner report is not a vulnerability-free
  claim — it only covers known advisories.
- **Secret scanning.** CI greps for committed key
  material (private keys, AWS key ids) outside tests;
  `.env` must never exist in CI. Test fixtures use
  obviously-fake values (`hunter2`-style), never
  real-shaped credentials.

## Reproducible installs

Same commit + `npm ci` installs the identical tree on
every machine (lockfile v3 with integrity hashes). If
`npm ci` fails on a lockfile mismatch, delete nothing by
hand — regenerate with `npm install` on the matching
Node major (22) and commit the result.

## License inventory refresh

Re-run when dependencies change:

```powershell
npm ls --depth=0
# spot-check new entries:
node -p "require('./node_modules/<pkg>/package.json').license"
```

For a full transitive report, run
`npx license-checker --summary` as a one-shot (not a
dependency) and attach the output to the PR.
