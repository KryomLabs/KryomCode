# KryomCode Provider Guide

How the AI provider platform works and how to add a provider.

## Concepts

- **Descriptor**: static metadata (id, display name, models,
  auth needs). Validated by `provider-registry.cjs`.
- **Catalog**: read model of every registered provider's
  models (`model-catalog.cjs`). Unknown capabilities stay
  unknown — the catalog never invents limits.
- **Config**: user selection only (`provider-config.cjs`).
  Secrets live in the secret allowlist (environment first, then the
  OS-encrypted credential vault), never in the config file.
- **Router** (`router.cjs`): resolves selection → provider +
  model, validates capability requirements, applies fallback
  only when explicitly configured.

Meta AI (`meta`) is first-class and stays the default. The
mock provider exists for tests only and is never registered
as a builtin.

## Descriptor shape

```js
{
  id: 'meta',                    // 2-40 lowercase, digits, dashes
  displayName: 'Meta AI',
  description: '...',            // optional
  version: '1.0.0',              // optional
  auth: { kind: 'api-key', secretEnv: 'MODEL_API_KEY' },
  // or: auth: { kind: 'none' }
  models: [
    {
      id: 'muse-spark-1.3',
      displayName: 'Muse Spark 1.3',
      capabilities: { text: true, streaming: false, vision: false, tools: false },
      contextWindow: null,       // null = unknown
      tokenUsage: false,
    },
  ],
}
```

Rules enforced by `normalizeDescriptor`:

- 1–50 models, unique ids.
- `auth.kind` is `none` or `api-key`; api-key needs an
  allowlisted secret name (`secrets.service.cjs`).
- Duplicate provider ids are rejected.

## Adding a provider

1. Implement the text interface beside
   `electron/services/ai/providers/` (follow
   `meta-muse.provider.cjs`: normalized errors, timeouts,
   cancellation).
2. Export a descriptor and register it in
   `registerBuiltins()` (or call `registerProvider` from a
   test).
3. Add a colocated `*.test.cjs` covering registration,
   routing, failure, timeout, cancellation, redaction.
4. Never store keys in the provider config or return them
   from any channel. `describeProvider` reports only
   `{ kind, configured }` booleans.

## User-owned keys (Settings → Providers)

Every installation accepts its own Meta API key; the product never
depends on a developer key being distributed with it:

- `provider:set-key` / `provider:remove-key` /
  `provider:key-status` are the only key channels. Keys travel
  renderer → main only and responses carry presence info alone
  (`configured`, `source`); stored keys are never returned.
- `credential-vault.cjs` encrypts keys with Electron `safeStorage`
  before persisting them under the userData folder, and loads them
  into main-process memory at startup.
- Environment secrets always win over vault secrets, so `.env`
  development keeps working untouched and is never copied into the
  vault automatically.
- `app:get-ai-status` additionally reports each key's source
  (`environment` / `vault` / `missing`) and whether the vault backend
  is available, so the UI can explain the configuration honestly.

## Routing behavior

- `defaultRoute()` reports the current selection for the UI.
- `resolveRoute({ provider, model, requires, feature })`
  validates the model exists, is enabled, is available
  (credentials present), and supports every required
  capability.
- Fallback applies only when the config names one, and the
  result reports `usedFallback: true`. Silent switching
  never happens.
- `normalizeProviderError` maps provider failures to coded
  errors; cancellation propagates.

See `docs/PLATFORM_API.md` for the renderer-facing
`provider:*` channels.
