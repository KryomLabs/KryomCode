# Contributing to KryomCode

Thanks for helping. KryomCode is an Electron + React +
TypeScript desktop app; start with
[docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) to get
running, then read this file before opening a pull request.

## Ground rules

- **No secrets in commits.** No API keys, tokens, `.env`
  contents, private paths, or private `.kryom` data — in
  code, tests, fixtures, or screenshots.
- **Tests required for behavior changes.** Backend: colocated
  `*.test.cjs` next to the module, listed in the `test`
  script in `package.json` (the `check:test-manifest` gate
  enforces this). Use temp dirs and mocks; no network, no
  real credentials.
- **Docs for user-facing features.** Update the relevant
  `docs/` page plus `docs/CHANGELOG.md` (Unreleased).
- **Security review for privileged code.** Anything touching
  IPC, filesystem, processes, terminals, providers,
  permissions, or extensions needs a threat-model paragraph
  in the PR (what can a malicious input reach?).
- **Backward compatibility.** IPC channels, preload methods,
  `src/electron.d.ts`, the extension manifest, and
  `sdk/kryom.d.ts` are public contracts. Additive changes
  are fine; renames/removals need a versioned migration
  with tests.
- **Focused PRs.** No unrelated large refactors alongside a
  fix or feature.

## Workflow

1. Fork, branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Implement with the existing patterns (CommonJS `.cjs`
   backend, `kryom()` bridge calls in the UI, `assert*`
   validators on every IPC payload).
3. Run the gates (see below) — all green before review.
4. Open a PR using the template; fill in tests, docs, and
   the security paragraph.

## Required gates

```powershell
npm test
npm run check:syntax
npm run check:test-manifest
npm run check:workbench
npm run test:renderer     # after npm install (vitest devDeps)
npx tsc -b
npm run build
npm run check:release   # after npm run pack
```

`npm run pack` + `check:release` are required when touching
packaging, backend file layout, or release config.

## Code style

- Backend: CommonJS `.cjs`, early returns, `async`/`await`
  without floating promises, redacted logging via
  `utils/logger.cjs` (never `console.log` secrets).
- Frontend: TypeScript + React, existing CSS classes only
  (no new design system), `errorMessage()` for failures,
  no hardcoded strings in new UI (use `src/i18n`).
- No new dependencies without justification in the PR:
  what exists was evaluated first, license checked,
  lockfile updated via `npm install`.

## Commit messages

Short imperative subject, optional body:

```
fix(terminal): kill detached process groups on POSIX cancel

Cancellation left grandchildren behind because only the shell
died. Spawn POSIX children detached and signal the group.
```

Scopes: `agent`, `terminal`, `git`, `ipc`, `ui`,
`extensions`, `platform`, `docs`, `ci`, `deps`.

## Review process

Maintainers check: gates green, tests meaningful (not just
coverage), docs accurate, no contract breaks, no secrets, no
fake functionality. Expect at least one review round on
privileged code. Be kind; assume good intent; the
[Code of Conduct](CODE_OF_CONDUCT.md) applies.
