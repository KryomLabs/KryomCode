# KryomCode Security

What the app protects, where the boundaries are, and what remains the
user's responsibility. This documents the implemented controls, not
aspirations.

## Secret handling

- The Meta API key lives only in the main process environment
  (`MODEL_API_KEY`). `electron/main.cjs` loads it from `.env` in
  development; packaged builds read the user environment variable.
- `electron/services/settings/secrets.service.cjs` is the central
  allowlist: `getSecret` serves only `MODEL_API_KEY` and throws for any
  other name.
- The key is never exposed to the renderer: no preload method returns
  it, and settings storage holds preferences only.
- Terminal and Git child processes receive a scrubbed environment
  (`buildChildEnv` deletes allowlisted secret keys).
- The logger (`electron/utils/logger.cjs`) redacts `Bearer` tokens and
  secret-shaped keys/values from text and objects.
- `.env` is Git-ignored; `.env.example` contains placeholders only; the
  packaged app excludes `.env` files from its file set.
- A repository scan during Phase 3 found no hardcoded keys: matches
  were limited to `test-key` fixtures, env plumbing, and redaction
  patterns.

## Renderer isolation

- `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration:
  false`, and `sandbox: true`.
- The renderer reaches the main process only through the
  `window.kryom` bridge. No Node APIs, no `require`, no raw IPC.
- New windows are denied (`setWindowOpenHandler`) and navigation is
  limited to the dev server origin and `file:` URLs.

## IPC authorization

Every `ipcMain.handle` callback first calls `isTrustedSender(event)`,
which requires the sender to be the app's own live main window. Payload
shapes and lengths are then validated with
`electron/security/validate-input.cjs`. Only the error message crosses
back to the renderer; coded errors (`electron/utils/errors.cjs`) stay
in the main process.

## Workspace containment

- All file, terminal, Git, diagnostics, and agent operations resolve
  paths through `resolveWorkspacePath`, which rejects traversal outside
  the open root, refuses symlinks (including ancestor symlinks for
  not-yet-existing paths), and rejects operations targeting the root
  itself unless explicitly allowed.
- The file tree, search, and intelligence indexes skip `node_modules`,
  `.git`, build output, and `.env*` files, and report truncation
  instead of silently cutting results.
- Reads and writes are capped at 1 MB per file.

## Approval workflow

| Operation | Approval boundary |
|---|---|
| Terminal command | One explicit `terminal:run` call per command. Warnings are advisory metadata, never a safety verdict. |
| Agent plan | `agent:plan` only proposes. The UI shows diffs; nothing is written during planning. |
| Agent apply | `agent:apply` writes only the caller-supplied edits after re-validating each one, with rollback on failure. Planned commands are never executed. |
| Git commit / push | Separate explicit channels. Push uses ambient Git credentials, which KryomCode never handles. |
| File delete / overwrite | Renderer confirm and conflict dialogs; backend re-validates. |

## User responsibilities

- Terminal commands execute with your OS user permissions. Review every
  command, especially agent-suggested ones, before running it.
- Only open project folders you trust. Git features use standard
  ancestor discovery, so a folder inside another repository reports
  that repository's state.
- Treat AI output as untrusted: review each planned edit before
  approving, and never paste secrets into prompts.
- Keep `.env` and the packaged machine's environment variable private;
  anyone with the key can bill your Meta account.

## Reporting

Suspected vulnerabilities should be reported privately to the KryomLabs
maintainers, not through public issues, until a fix is available.
