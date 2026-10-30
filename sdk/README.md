# KryomCode Extension SDK

Minimal, dependency-free types for extension developers.

- `kryom.d.ts` — the sandboxed `kryom` membrane, the extension
  manifest, permissions, and the error taxonomy (API v1).
- `../examples/hello-command/` — a working sample extension.
- `../docs/DEV_API.md` — API reference, compatibility rules, and
  the development walkthrough.
- `../docs/EXTENSIONS.md` — manifest reference and security model.

Reference the types from extension JavaScript with JSDoc:

```js
/** @param {import('../../sdk/kryom').KryomExtensionAPI} kryom */
function activate(kryom) { /* ... */ }
```

Or import them from TypeScript and compile to a single `main.js`.
