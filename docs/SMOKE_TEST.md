# KryomCode Windows GUI Smoke Test

Manual release-gate checklist for the actual desktop app. Automated tests
cannot click through the real UI, so run this on Windows before calling
any release demo-ready. Use a **disposable test project** and harmless
commands only — never point these steps at the KryomCode repo itself.

Time: ~30 minutes (less with a configured model key).

## Setup (once)

```powershell
# Disposable project OUTSIDE the KryomCode repo:
mkdir $env:USERPROFILE\Documents\kryom-smoke
cd $env:USERPROFILE\Documents\kryom-smoke
git init
"console.log('smoke')" | Out-File -Encoding utf8 hello.js
"# smoke project" | Out-File -Encoding utf8 README.md
git add -A; git commit -m "smoke fixture"
```

Start the app from the KryomCode repo (this is the only supported
dev-launch script; do not invent others):

```powershell
cd C:\Users\LENOVO\Documents\KryomLabs\kryomcode
npm run dev
```

Expect: Vite serves `http://127.0.0.1:5173`, then the KryomCode window
opens on the welcome screen ("What should we build or discover?").

## Checklist

| # | Step | Expected |
|---|------|----------|
| 1 | Launch via `npm run dev`. | Welcome screen renders; no blank window, no error dialog. |
| 2 | In **Explorer**, click **Open Project**, pick `kryom-smoke`. | Explorer lists `hello.js`, `README.md`. |
| 3 | Click `hello.js`; type a comment line. | Monaco editor loads with highlighting; typing works; tab shows `•`. |
| 4 | Press **Ctrl+S**; check the file on disk (`type hello.js` in a separate terminal). | Dirty dot clears; disk contents match the editor. |
| 5 | Open the bottom panel's **Terminal** tab, enter `node --version` (fallback: `echo smoke-ok`), click **Run**. | Entry shows the command, real output, and exit code 0. |
| 6 | Open **AI Chat** and send a message with **no** `MODEL_API_KEY` configured. | Honest notice: "AI model is not configured…", no spinner hang, no crash. With a key: a real single-shot answer arrives (no streaming). |
| 7 | Open **Research**, enter an objective (e.g. "retry strategies for flaky network calls"), click **Start research**. | Progress steps, **Sources** list with **Open**/**Copy**, and an **Errors** section if a provider fails. **Cancel** stops a running session. |
| 8 | Open the **Coding agent**, check **Include active file**, use **Search** + **Add** to select `hello.js`. | Footer reads "N file(s) selected"; selected files listed with **Remove**. |
| 9 | Task: "Add a one-line comment at the top of hello.js explaining what it does." Click **Plan task**. | Status line walks Inspecting → Gathering → Planning → "Awaiting review"; context preview shows "Model context: N file(s)…" plus any "Excluded …: reason" lines. |
| 10 | Inspect the plan view. | Each edit shows a **Why:** rationale; modify-edits show a diff; **Proposed commands (never executed automatically)** lists commands with **Copy**. |
| 11 | Before approving: run `git status --short` in the smoke repo (external terminal). | No modified files — planning alone changed nothing. |
| 12 | Keep one edit checked, click **Apply approved edits**, confirm the **Apply agent edits?** dialog. | "Applied N edit(s)."; the file on disk actually changed. |
| 13 | In **Verification**, note **Working directory** and **Will run:**, pick/type `node --version`, click **Run check**, confirm the dialog. | Dialog shows the exact command + cwd; result shows "Check passed.", the real exit code, and output. |
| 14a | Run a failing check: custom command `node --no-such-flag-xyz`. | "Check failed. Exit code: 1", output shown, **Request fix** offered. |
| 14b | Start a plan, click **Stop** mid-planning. | Status becomes **Cancelled** ("Planning cancelled"); panel stays usable. |
| 14c | Plan a modify-edit, then change that file externally (Notepad) before applying; apply. | Apply rejected as stale ("changed since the plan"); **Plan again with current files** offered; rollback message shown. |
| 15 | Close and relaunch the app; reopen the smoke project. | Project reopens; editor files and chat history intact. |
| 16 | Edit `hello.js` in the app (do not save); edit it externally; press **Ctrl+S**. | **Unsaved changes conflict** dialog with **Reload disk version** / **Overwrite disk version**; both paths work. |
| 17 | Open the bottom panel's **Source Control** tab, click **Refresh**. | **Staged** list contains no `.kryom/…` entries. Cross-check externally: `git status --short` shows `.kryom/` untracked at most. |

## Offline editor check (Monaco local bundling)

1. Disconnect the machine from the network (airplane mode or unplug).
2. Quit KryomCode fully, relaunch with `npm run dev`.
3. Open `hello.js`, type, save.

Expected: the editor initializes, highlights, and saves with no
network. If it hangs on a spinner, local bundling regressed.

## Recording results

Copy this table into the release note or
[backend-limitations.md](backend-limitations.md) with the date:

| Step | Pass / Fail | Notes (build, model, key/no-key) |
|------|-------------|----------------------------------|
| 1–17 | | |
| Offline editor | | |

Steps 11, 13–14, and 16–17 are also pinned by automated backend tests
(agent stale/rollback, diagnostics exit codes, conflict detection,
`.kryom` ignore); the GUI pass proves the wiring, not just the units.
