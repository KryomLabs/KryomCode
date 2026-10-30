# KryomCode Security Architecture

How the controls in [THREAT_MODEL.md](THREAT_MODEL.md) are
built. File references are exact.

## Process model

- **Main** (`electron/main.cjs`): windows, menus, protocol
  handler, IPC registration, crash handlers, shutdown.
  Creates one `BrowserWindow` per window with
  `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`.
- **Preload** (`electron/preload.cjs`): exposes a fixed
  `kryom()` method table over `ipcRenderer.invoke` plus
  narrow event subscriptions. No direct `ipcRenderer`,
  no `require`, no Node globals leak.
- **Renderer** (`src/`): React UI. Every backend call goes
  through `kryom()` (`src/api/kryom.ts`); a missing bridge
  fails loudly.
- **Extension workers**
  (`electron/services/extensions/worker/`): one
  `utilityProcess` (production) or `fork` (plain Node)
  child per active extension. The child runs
  `runtime.cjs`'s vm sandbox; the parent
  (`extension-host.cjs`) enforces timeouts, a sampled RSS
  cap, message validation, and crash recovery.
- **Task children**: terminal commands, git, and research
  fetchers spawn with scrubbed envs, timeouts, and
  registry-tracked cancellation
  (`services/terminal/process-manager.cjs`).

## Window and navigation hardening (main.cjs)

- `setWindowOpenHandler` denies all popups.
- `setPermissionRequestHandler` denies all Chromium
  permission requests (camera/mic/geolocation/etc.).
- `will-navigate` allows only the app entry and the dev
  server in development; everything else opens externally
  or is blocked.
- DevTools have no menu/shortcut path and auto-close in
  packaged builds unless `KRYOM_DEVTOOLS=1`.
- CSP: restrictive production policy, HMR-scoped dev
  policy, both generated from
  `electron/security/content-security-policy.cjs` and
  injected into `index.html` at build time plus the
  `kryom://` protocol headers.

## IPC authorization

- `isTrustedSender(event)` (frame URL + type check) runs
  FIRST in every handler; the integration suite sweeps
  every channel with an untrusted sender.
- Payloads validate with `assertPlainObject`,
  `assertNonEmptyString`, and friends
  (`electron/security/validate-input.cjs`).
- No channel accepts executable paths, shell strings
  beyond the terminal's own validated command path, or
  URLs that choose trusted destinations (update feed,
  open-external allowlist).

## Filesystem and execution

- `electron/security/validate-path.cjs` contains every
  file operation to the open workspace or explicit
  user-chosen paths; `..` escapes and absolute-path
  injections are rejected.
- Writes and command runs require user approval
  (`confirmAllCommands` default-on semantics per surface),
  checkpoint before apply, and support cancel/rollback.
- Terminal: `shell: true` with the platform shell is
  intentional (user-typed commands), but commands are
  classified, output-capped, timeout-bound
  (`terminal.service.cjs`), and tree-killed on cancel
  (taskkill on Windows, process-group signal on POSIX).
- Git: `shell: false` with argument arrays, scrubbed env
  (no `GIT_DIR` inheritance), timeouts, and redacted
  errors (`git-privacy`).

## Secrets

- `services/settings/secrets.service.cjs`: allowlist of
  exactly `MODEL_API_KEY`, `TAVILY_API_KEY`. Only these
  are readable, scrubbed from child envs, and redacted.
- `utils/logger.cjs`: every log line passes the redactor
  (key=value, Bearer tokens,---

...[truncated 1337 chars]