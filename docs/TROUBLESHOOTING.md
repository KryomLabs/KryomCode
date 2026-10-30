# Troubleshooting

## The app window is blank / won't start

- Dev: is Vite running on `http://127.0.0.1:5173`? `npm
  run dev` starts it; a port conflict kills the renderer.
  The main log says "Dev server unavailable" when it
  falls back to `dist/`.
- Packaged: the startup dialog offers Relaunch. If it
  persists, launch the executable from a terminal once —
  main-process errors print to the console — and include
  the redacted output in your report. (No log file is
  written; file logging is deferred.) Your projects are
  untouched by startup failures.

## AI calls fail

- `MODEL_API_KEY` missing: copy `.env.example` to `.env`
  in development; packaged builds read your user
  environment (see INSTALLATION.md). The Providers tab
  shows "key missing" instead of failing silently.
- Wrong model: Settings → default model, or the
  Providers tab selection. The app never silently
  switches providers — a misconfiguration errors loudly.

## Git panel says git is missing

Install Git and restart the app so `PATH` refreshes. The
editor, index, and AI features work without Git.

## Terminal command hangs

Every run has a timeout and a Cancel button; cancel kills
the whole process tree. If output stops growing, the
command is waiting on stdin (interactive prompts are not
supported) — cancel it and rerun non-interactively.

## Extension won't activate

PLATFORM → Extensions shows the recorded `lastError`.
Common causes: missing dependency (`dependencies` in the
manifest), a permission the host denied, or a crash in
`activate` (the child dies; the app survives — check the
main log `[ext:<id>]` lines). Uninstall removes the
extension's files and private storage.

## Update check says no feed

Expected until the owner publishes one: with no
`KRYOM_UPDATE_FEED` and no baked feed URL, checks report
"unavailable" instead of failing. See RELEASING.md.

## Tests fail locally

- Run `npm ci` first (stale `node_modules` is the usual
  cause).
- One file: `node --test <path>` for the focused error.
- New `*.test.cjs` must be added to the `test` script or
  `check:test-manifest` fails by design.
- Never run the suite against your real home directory
  fixtures — tests use temp dirs; failures mentioning
  your username mean a test leaked a real path (file a
  bug with the test name, redacted).

## Still stuck?

Export Help → Export Diagnostics, review the preview
(no secrets, home folder shown as `~`), and attach it to
a bug report (see `.github/ISSUE_TEMPLATE/`). Include
the app version, OS, and exact repro steps.
