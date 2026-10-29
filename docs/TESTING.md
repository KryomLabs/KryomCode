# KryomCode Testing

## Running the suite

```powershell
npm test             # full backend suite (Node test runner)
npm run check:syntax # static gate: node --check over electron/**/*.cjs
npm run build        # tsc -b + Vite build (also type-checks the renderer)
```

`npm test` lists its files explicitly in `package.json`. When adding a
colocated test, append the new path to that script or CI will not run
it.

## Test inventory

All tests use the built-in `node:test` runner with
`node:assert/strict`. No test framework dependency is required.

| Test file | What it covers |
|---|---|
| `electron/services/terminal/terminal.service.test.cjs` | Command validation, secret scrubbing from child env, timeout/output caps |
| `electron/services/workspace/workspace.service.test.cjs` | Root state, containment, bounded tree |
| `electron/services/ai/ai.service.test.cjs` | Prompt/history/context limits, key requirement, mock delegation |
| `electron/services/ai/ai-config.service.test.cjs` | Model allowlist, `META_MODEL` handling, missing-key error |
| `electron/services/ai/providers/meta-muse.provider.test.cjs` | Auth/rate-limit mapping, timeouts, cancellation, malformed replies (mocked fetch) |
| `electron/services/filesystem/directory.service.test.cjs` | Create/rename/delete, conditional writes, conflict detection |
| `electron/services/filesystem/file-search.service.test.cjs` | Name/content search bounds and truncation |
| `electron/services/git/git.service.test.cjs` | Status parsing, stage/commit/push validation, ref safety |
| `electron/services/diagnostics/diagnostics.service.test.cjs` | Exit-code success rule, parser integration |
| `electron/services/project-intelligence/project-analyzer.service.test.cjs` | Index bounds, `.env` exclusion, context caps |
| `electron/services/agent/agent.service.test.cjs` | Plan validation, apply allowlist, rollback |
| `electron/services/settings/settings.service.test.cjs` | Defaults, patch validation, sanitization |
| `electron/security/security.test.cjs` | Sender, path, and input guards |
| `electron/utils/utils.test.cjs` | Error shapes, secret redaction |
| `electron/wiring.test.cjs` | Every module loads with its exports; every IPC module exports a register function; main/preload relative requires resolve |

Notes:

- AI and agent tests inject `MockProvider` or stub `fetch`; the suite
  makes no network calls.
- There is no renderer unit-test setup. Renderer correctness is covered
  by `tsc -b`, the Vite build, and manual checks.
- `file.service.cjs` and `git-diff.service.cjs` have no dedicated test
  files; their exports are pinned by the wiring test.

## Conventions for new tests

- Colocate as `<module>.test.cjs` next to the module under test.
- Use `node:test` (`describe`/`it`) and `node:assert/strict`.
- Never use real keys, real network, or the real user-data folder:
  stub `fetch`, inject the mock provider, pass explicit base dirs, and
  restore `process.env` in `afterEach`.
- Prefer small fixture directories under the OS temp dir over touching
  the repository.

## Manual checks

Automated tests cannot cover these; run them before claiming a release
works. The step-by-step release gate (including the offline-editor
check) is [SMOKE_TEST.md](SMOKE_TEST.md); the list below is the
shorter per-feature reminder:

1. `npm run dev` launches and each panel (Explorer, Search, Editor,
   AI Chat, Agent, Terminal, Problems, Git, Settings) responds.
2. One real-key AI chat request per model returns a non-empty answer.
3. One real-key agent plan produces a valid, previewable plan.
4. A save conflict (edit the file externally, then save) offers
   reload/overwrite and both paths work.
5. `npm run pack` output launches, loads `dist/`, stores settings, and
   picks up `MODEL_API_KEY` from the user environment.
6. The `npm run dist` installer installs and starts on a clean machine.
7. Close the window with dirty tabs: Save persists all and closes,
   Discard closes without saving, Cancel leaves the window open; a
   clean window closes without a prompt.
8. Run diagnostics: markers appear in the editor gutter, F8 cycles
   them, and rerunning or switching projects clears stale markers.
9. A research source Open button launches the system browser; chat
   code blocks render with working Copy buttons.
10. Chat Stop aborts a slow request with a "cancelled" status (no
    error box); planning Stop does the same for the agent.
11. Chat history survives a restart per project; switching projects
    shows each project's own conversation.
12. Cancelling or timing out a long terminal command leaves no
    orphan processes (check the task manager for grandchildren).

Record completed manual checks in
[backend-limitations.md](backend-limitations.md) with the date.
