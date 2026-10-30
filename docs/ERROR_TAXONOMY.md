# Error taxonomy

How KryomCode reports failures from the main process to the renderer.
Level 2B.6 deliverable.

## The IPC contract

`ipcMain.handle` rejections reach the renderer as plain `Error` objects:
**only `error.message` crosses the boundary**. Structured fields such as
`code` do not survive, so the human-readable message is the contract and
must be stable, self-contained, and safe to display.

The renderer reads failures through two helpers (`src/api/kryom.ts`):

- `errorMessage(error)` — shows `error.message`, or
  `'An unexpected error occurred.'` for non-errors.
- Regex classifiers on documented wording (see "Pinned wording" below).

## Coded errors (`electron/utils/errors.cjs`)

Codes exist for main-process branching and precise tests, not for the
renderer. Use `createError(code, message)` when a main-process caller or a
test needs to distinguish the failure mode; otherwise throw a plain
`Error` with a stable message.

| Code | Meaning | Typical source |
|---|---|---|
| `E_WORKSPACE_CLOSED` | No project folder is open | workspace-backed services |
| `E_PATH_TRAVERSAL` | Path escapes the workspace | path validation |
| `E_NOT_FOUND` | Expected file/record is missing | stores, checkpoint undo |
| `E_ALREADY_EXISTS` | Create would overwrite | file/folder creation |
| `E_WRITE_CONFLICT` | File changed on disk since read | guarded writes |
| `E_VALIDATION` | Caller argument rejected | `validate-input.cjs`, plan checks |
| `E_TIMEOUT` | Bounded wait expired | process runs, provider calls |
| `E_PROCESS` | Child-process failure | terminal, diagnostics |
| `E_GIT` | Git operation failure | git service |
| `E_AI_CONFIG` | Provider not configured | provider constructor |
| `E_AI_REQUEST` | Provider call failure | chat completions |
| `E_AGENT` | Agent planning/apply failure | agent orchestration |
| `E_SETTINGS` | Settings value rejected | settings validation |

Helpers:

- `validationError(message)` — shorthand for `E_VALIDATION`.
- `isCodedError(error)` — true for `Error` instances with a string `code`.
- `boundDetail(text, max)` — coerces external text to a trimmed string of
  at most `max` characters (non-strings become `''`).

## Message conventions

1. **Actionable plain sentences.** Say what happened and what to do next:
   `'Nothing to commit. Stage changes first.'` Prefer the imperative for
   the next step (`'Open a project folder first.'`).
2. **Stable and pinned.** Messages the renderer branches on, or that tests
   assert, must not be reworded without updating the classifier, the doc,
   and the pinning test together.
3. **No secrets, ever.** Never echo API keys, tokens, credentials, or
   `Authorization` headers. Server and tool output is untrusted: pass it
   through `boundDetail` before embedding it in a message.
4. **External text is always bounded.** `stderr`, `stdout`, and HTTP error
   bodies are trimmed and length-capped (git: 2000 chars, provider: 500
   chars) so a hostile or enormous tool output cannot flood the UI.
5. **Fallback wording.** Every external-detail site has a static fallback
   (`'Git push failed.'`, `'Meta API request failed (500).'`) used when
   the detail is empty.
6. **One idea per message.** Join multi-part validation output with
   `' | '`, never with newlines (single-line UI surfaces).
7. **Prefer shared sentinels.** Reuse `'Open a project folder first.'`
   for the no-workspace state instead of inventing per-surface variants.

## Pinned wording (renderer contracts)

These substrings are load-bearing: the renderer classifies on them.

| Substring | Meaning | Renderer use |
|---|---|---|
| `changed on disk` | Guarded write lost a race | `isWriteConflict` → reload prompt |
| `cancelled` (double-l spelling) | User or timeout aborted the op | `isCancelError` → cancelled UI, not an error box |

Full pinned messages (asserted by tests):

- `'File changed on disk since it was opened. Reload before saving.'`
- `'Research was cancelled.'`, `'Meta AI request was cancelled.'`
- `'Command cancelled by user.'` (main-process destructive-command
  approval decline; matches `isCancelError`)
- `'Open a project folder first.'`
- `'Unauthorized <surface> request.'` (per-IPC trust guard)

## What was fixed in the 2B.6 audit

- Git `stderr`/`stdout` detail is now bounded to 2000 chars at every
  failure site (`status`, `stage`, `unstage`, `discard`, `commit`,
  `remote lookup`, `diff`, `changed-files`); previously six sites passed
  unbounded tool output to the UI.
- Meta provider HTTP error detail from the server body is coerced to a
  string and bounded to 500 chars; non-string bodies fall back to
  `'Meta API request failed (<status>).'`
