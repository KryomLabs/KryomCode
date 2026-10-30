# KryomCode Threat Model

What we defend, what we assume, and what we explicitly do
not promise. Every control named here exists in the tree;
residual risks are labeled as such.

## Assets

1. User source code and project files.
2. API keys and tokens (Meta provider key, Tavily key).
3. Local app state (settings, sessions, plans, checkpoints,
   indexes, grants, audit log).
4. Integrity of the running app (no silent code execution,
   no silent updates, no silent provider switching).

## Trust boundaries

```
┌─────────────┐  preload bridge   ┌──────────────────┐
│  Renderer   │ ── 51+ typed ────▶ │  Main process    │
│  (untrusted │    methods only   │  (privileged)    │
│   input)    │ ◀── JSON data ─── │  services        │
└─────────────┘                   └──────┬───────────┘
                                         │ fork/utility child
                                         ▼
                                  ┌──────────────────┐
                                  │ Extension worker │  one per active
                                  │ vm sandbox       │  extension; parent
                                  │ inside child     │  enforces timeouts
                                  └──────────────────┘  + memory cap
```

- **Renderer → main**: every channel checks
  `isTrustedSender` first, then validates payloads with
  `assert*` validators. The renderer holds no Node.js, no
  filesystem, no child processes (`contextIsolation`,
  `sandbox`, `nodeIntegration: false`).
- **Extension code → host**: extension JS sees only the
  `kryom` membrane (declared commands + permission-gated
  calls). The membrane runs in `node:vm` inside a dedicated
  child process; the parent kills the child on timeout,
  memory-cap breach, crash, or protocol violation.
- **Child processes**: terminal/git/extension children get
  scrubbed environments (secret keys removed except where
  the provider call legitimately needs them in the
  extension worker).
- **Network**: AI providers, research sources, git
  remotes, and the update feed. Update URLs must be https
  and can only come from baked config or operator env —
  never renderer input.

## Threats and controls

| Threat | Control | Residual |
| ------ | ------- | -------- |
| Malicious renderer input reaches fs/shell | Sender + schema validation on every channel; workspace containment; path traversal rejection; approval gates for writes/exec | None known; fuzz coverage is manual |
| Path traversal / symlink escape | `validate-path` containment on every file op | Symlink races are best-effort (TOCTOU documented) |
| Secret exfiltration via logs/diagnostics/AI | Central allowlist; redacting logger; presence-only booleans over IPC; redacted support bundle | A key pasted INTO a prompt is sent to that provider by design |
| Silent provider/model switching | Explicit selection + explicit fallback only; `usedFallback` reported | None |
| Extension steals data / crashes app | Disabled-by-default install; explicit grants; per-call permission checks; isolated child + timeouts + memory cap + crash recovery | NOT a hardened hostile-code sandbox (see below) |
| Malicious update replaces install | No auto-install; https-only feed; strict manifest schema; sha512 verification; staging quarantined; failures clear staging | No code signing yet — owner certs required before public release |
| Supply chain (deps) | Lockfile + `npm ci`; `npm audit` in CI; minimal dep set; asar excludes tests/secrets | No lockfile pin audit service; review is manual |
| Stale AI context causes bad edits | Fingerprinted index; freshness checks; checkpoints + rollback; per-task approval | User can still approve against stale context — shown, not hidden |

## Explicitly out of scope

- **Arbitrary hostile extensions.** The child-process +
  vm + permission architecture raises the bar substantially
  over in-process vm alone, but it is not an OS-hardened
  sandbox (no seccomp/AppContainer/job-object confinement,
  soft memory sampling instead of hard cgroup limits).
  **Do not install extensions you do not trust.**
  Extension installation stays disabled-by-default with
  explicit user trust for this reason.
- **A compromised operating system or Electron/Chromium
  itself.** We track Electron security releases but do
  not sandbox the main process from the OS.
- **AI provider behavior.** What Meta (or any configured
  provider) does with an approved prompt is governed by
  their policy, not ours.

## Reporting

See [SECURITY.md](../SECURITY.md). Private disclosure via
GitHub Security Advisories; no public issues for suspected
vulnerabilities.
