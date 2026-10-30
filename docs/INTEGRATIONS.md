# KryomCode Integration Adapter Guide

How external developer services plug into KryomCode, and
what the GitHub adapter actually does.

## Adapter contract

An adapter is a plain object registered with
`integrations/registry.cjs`:

```js
{
  id: 'github',              // 2-40 lowercase, digits, dashes
  displayName: 'GitHub (local git)',
  description: '...',
  auth: { kind: 'none' },    // none | token-env | oauth
  // token-env adds: secretEnv: '<ALLOWLISTED_NAME>'
  capabilities: ['repositories.local', 'branches', 'remotes', 'history'],
  status,                    // required: () => { connected, state, ... }
  disconnect,                // required: clears local state
  connect,                   // optional
  repositories,              // optional
  history,                   // optional
}
```

Rules:

- Duplicate ids are rejected.
- `token-env` auth must name an allowlisted secret; the
  token itself never leaves the main process — the
  renderer only sees connection state.
- `oauth` is a declared kind for future adapters; no
  OAuth flow ships yet.
- Errors normalize through
  `normalizeIntegrationError` (message + `authFailure`
  flag); tokens are redacted before anything is logged.
- Adapters are isolated: GitHub-specific code lives in
  `github.adapter.cjs`, never in the registry.

## GitHub adapter (local git)

The only shipped adapter. It shells out to the existing
safe git service — it holds no tokens and makes no API
calls:

- `status`: connected when the open project is a git
  repo; reports branch, remotes, and whether a GitHub
  remote was detected.
- `connect`: verifies the origin remote over the
  existing git channel (https-only, GitHub allowlist);
  without verification the state stays `local-only`.
- `repositories`: the current local repository, if any.
- `history`: `git log` with a bounded count.
- `disconnect`: clears recorded state (nothing to
  revoke — there are no credentials).

Explicitly unsupported: pull requests, issues, and any
write operation. Adding them needs a real token flow
with approval gates — not a fake button.

## Future adapters

GitLab, Jira, Linear, Slack, CI systems, and others fit
the same contract. Implement one only with real API
access and credentials; until then the contract above is
the documentation, not a stub connection.
