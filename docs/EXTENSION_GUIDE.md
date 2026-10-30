# KryomCode Extension Guide

Architecture, manifest reference, security model, and a
walkthrough for the local extension system.

## Architecture

```
kryom-extension.json  →  manifest.cjs (validate)
local folder          →  registry.cjs (install record, disabled by default)
main.js               →  worker/extension-host.cjs (dedicated child per
                         active extension) → runtime.cjs (vm sandbox +
                         JSON membrane, inside the child)
lifecycle.cjs         →  install → verify → register → enable →
                         activate → deactivate → disable → uninstall
```

Only declared commands are invokable, and only while the
extension is active. There is no marketplace and no remote
registry; installation accepts local folders only
(`extension:pick-directory` + `extension:install`).

## Manifest reference (`kryom-extension.json`)

```json
{
  "manifestVersion": 1,
  "id": "acme.hello",
  "name": "Hello",
  "description": "Greets the user.",
  "version": "1.0.0",
  "publisher": "acme",
  "main": "main.js",
  "apiVersion": 1,
  "engines": { "kryomcode": "0.1.0" },
  "permissions": ["workspace.read"],
  "optionalPermissions": [],
  "contributes": {
    "commands": [{ "id": "acme.hello.run", "title": "Run" }]
  },
  "dependencies": {}
}
```

Rules enforced by `manifest.cjs`:

- `id` looks like `publisher.name` (2–40 chars each,
  lowercase/digits/dashes). Duplicates are rejected.
- `version` is semver `x.y.z`.
- `apiVersion` must equal the host `PLATFORM_API_VERSION`
  (currently 1); anything else is rejected.
- `main` is a relative `.js` path without traversal.
- `permissions` / `optionalPermissions` name real
  permissions (see `docs/SECURITY.md`); an entry cannot be
  both required and optional.
- `contributes.commands` holds at most 50 `{ id, title }`
  entries; command ids match
  `[a-z0-9-]{2,40}.[a-z0-9-.]{1,80}`.
- `dependencies` maps extension ids to exact or caret
  ranges; missing or mismatched dependencies block
  activation, and dependents block uninstall.
- `engines.kryomcode` declares a minimum host version.

## The `kryom` sandbox API (API v1)

`main.js` exports `activate(kryom)` (and optionally
`deactivate(kryom)`). The object passed in is the whole
API — there is no `require`, no `process`, no globals:

- `kryom.version`, `kryom.extensionId`
- `kryom.log(message)` — host-side log, redacted
- `kryom.commands.registerCommand(id, handler)` — at most
  50; handlers run with a timeout and JSON-only args
- `kryom.workspace.getMetadata()` — needs
  `workspace.metadata`
- `kryom.workspace.listFiles(prefix)` — needs
  `workspace.metadata`
- `kryom.workspace.readFile(path)` — needs
  `workspace.read`
- `kryom.storage.get(key)` / `set(key, value)` — private
  per-extension storage, size-capped
- `kryom.ai.complete({ prompt, model })` — needs
  `ai.provider`; prompt capped at 8000 chars

Permission checks run at the execution boundary on every
call. Revoking a grant breaks the next call, not the
current process.

## Security model

- Extensions never receive Node.js, filesystem, shell, or
  network access. Code runs in `node:vm` (code generation
  disabled, wall-clock timeouts) inside a dedicated child
  process — one per active extension — so a vm escape, a
  wedged loop, or a memory bomb kills the child, not the
  app. The parent enforces per-request timeouts, a sampled
  memory cap, message validation, and crash recovery.
- Data crosses a hardened membrane: null-prototype,
  JSON-serializable values only. Host objects never leak
  in; extension objects never leak out.
- Activation and command failures are contained —
  `lastError` is recorded and the host keeps running.
- Install is disabled-by-default and never
  auto-activates. Dev links register the folder without
  copying; uninstalling a dev extension never deletes
  the developer's directory.
- Startup recovery re-verifies every enabled extension;
  corrupt installs are disabled with a recorded reason.
- Audit events cover install, activation, activation
  failure, deactivation, and uninstall — with no secrets.

Residual risk: the child process has no OS-level
confinement (no seccomp/AppContainer/job-object policy)
and the memory cap is sampled from heartbeats, not a hard
cgroup limit. This is substantially stronger than
in-process vm alone, but it is not a hardened
hostile-code sandbox — do not install extensions you do
not trust. See `docs/THREAT_MODEL.md`.

## Walkthrough: hello-command

`examples/hello-command/` is a complete working extension:

1. Open KryomCode → PLATFORM → Extensions.
2. **Choose folder…** → `examples/hello-command` →
   **Install** (lands disabled).
3. **Enable** → **Activate** → open the detail → **Run**
   the hello command with `{}`.
4. **Deactivate** → **Disable** → **Uninstall**.

For the TypeScript types and the API stability contract,
see `sdk/README.md` and `docs/PLATFORM_API.md`.
