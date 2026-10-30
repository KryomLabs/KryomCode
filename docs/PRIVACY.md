# Privacy Implementation Reference

Companion to the user-facing [PRIVACY.md](../PRIVACY.md).
This page names the code that enforces each promise.

## Data inventory

| Data | Where it lives | Leaves the machine? |
| ---- | -------------- | ------------------- |
| Source files, `.kryom/` state | User's project dir | Only inside user-approved AI prompts |
| Settings, sessions, plans, grants, audit | Electron `userData` | Never (except the redacted diagnostics export the user saves) |
| API keys | Process env (dev `.env` or user env) | Only to the provider they belong to |
| Support bundle | User-chosen path | Never uploaded by the app |
| Update check | — | Version + platform to the feed, only on click |

## Enforcement points

- **Allowlist**: `services/settings/secrets.service.cjs`
  (`MODEL_API_KEY`, `TAVILY_API_KEY` only).
- **Logging**: `utils/logger.cjs` redacts key=value pairs,
  Bearer tokens, and known secret shapes on every line.
- **IPC**: provider channels return `{kind, configured}`
  booleans; no channel returns env vars or keys.
- **Child envs**: `buildChildEnv()` strips secret keys;
  the extension worker inherits env only because
  `ai.complete` legitimately needs the provider key, and
  extension code itself never sees env (no `process` in
  the vm).
- **Diagnostics**: `services/diagnostics/support-bundle.cjs`
  collects booleans/counts/redacted paths, replaces the
  home dir with `~`, caps error one-liners, and writes
  only to a user-chosen local file after a preview.
- **Research**: `url-fetch` posts queries, never file
  contents, to search providers.
- **AI context**: `context.service` attaches only files
  and diagnostics the user approved for that request.

## Adding a network call (contributor rule)

1. Disclose it in `PRIVACY.md` first (destination, data,
   trigger).
2. Keep it user-initiated or provider-driven; no
   background phoning-home.
3. Redact its errors before they reach logs, history, or
   diagnostics.
4. Add a test proving no secret crosses the new path.
