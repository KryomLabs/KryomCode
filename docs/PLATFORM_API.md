# KryomCode Platform API Reference

The versioned public contract for extensions and
integrations. Internal services are not public API.

## Versioning

- Current API version: **1**
  (`electron/services/platform/api-contract.cjs`).
- `SUPPORTED_API_VERSIONS = [1]`; `DEPRECATED_APIS = []`
  (nothing deprecated yet).
- `checkApiCompatibility(manifestApiVersion)` rejects any
  extension whose `apiVersion` is not currently
  supported. The public version moves independently of
  internal refactors.
- Backward-compatibility rule: v1 paths keep their
  names, argument shapes, and error codes. Breaking
  changes ship as a new version with the old one
  supported through a deprecation window — never as a
  silent change.

## Membrane surface (v1)

Every path an extension may call, with its permission
and caps:

| Path | Permission | Caps |
|---|---|---|
| `version`, `extensionId` | — | values only |
| `log` | — | 2000 chars |
| `commands.registerCommand` | — | 50 commands |
| `workspace.getMetadata` | `workspace.metadata` | — |
| `workspace.listFiles` | `workspace.metadata` | 200 files |
| `workspace.readFile` | `workspace.read` | 256 KiB |
| `storage.get` / `storage.set` | — (private store) | 120-char keys, 256 KiB values, 1 MiB quota |
| `ai.complete` | `ai.provider` | 8000-char prompt, 8000-char answer |

## Error taxonomy

`classifyMembraneError` maps failures to stable codes:

`PERMISSION_DENIED`, `TIMEOUT`, `INVALID_ARGS`,
`NOT_ACTIVE`, `UNKNOWN_COMMAND`, `QUOTA_EXCEEDED`,
`EXTENSION_FAULT` (anything else, including extension
bugs — the host never crashes).

## Renderer bridge

The preload bridge (`electron/preload.cjs`) exposes 51
typed `kryom()` methods over the `provider`, `permission`,
`audit`, `extension`, `skill`, `workflow`, `integration`,
and `template` channels. Types live in
`src/electron.d.ts` (`KryomProviderSummary`,
`KryomExtensionEntry`, `KryomSkillSummary`,
`KryomWorkflowRun`, `KryomIntegrationSummary`,
`KryomTemplateSummary`, …). Every channel enforces the
trusted-sender check and payload validation before any
service runs.

## SDK

`sdk/kryom.d.ts` carries the extension-side types
(manifest, `kryom` object, commands, storage, AI);
`sdk/README.md` is the usage guide with the
`examples/hello-command` walkthrough. No SDK dependency
is required — copy the `.d.ts` into the extension
project.
