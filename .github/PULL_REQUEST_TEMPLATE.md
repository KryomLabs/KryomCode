## Summary

<!-- What does this change, and why? Link issues with Fixes # / Relates to #. -->

## Tests

- [ ] New/updated colocated `*.test.cjs`, listed in the `test` script
- [ ] `npm test` green
- [ ] `npm run check:syntax` green
- [ ] `npm run check:test-manifest` green
- [ ] `npx tsc -b` green
- [ ] `npm run build` green
- [ ] `npm run pack` + `npm run check:release` green (if packaging/backend layout touched)

Paste focused-suite output for the touched area:

```

```

## Docs

- [ ] `docs/CHANGELOG.md` (Unreleased) updated
- [ ] User-facing behavior documented (or N/A — explain)

## Security review (required for privileged code)

<!-- IPC, filesystem, processes, terminals, providers, permissions,
extensions, updates, auth: what can malicious input reach here?
How is it contained? If no privileged surface changed, say N/A. -->

## Compatibility

- [ ] No IPC/preload/`electron.d.ts`/manifest/SDK contract breaks (or migration + tests included)
- [ ] No secrets, fixtures with real paths, or fake functionality added
