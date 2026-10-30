# Privacy Policy

KryomCode is a local-first desktop application. This policy
describes what the app does with your data. It covers the
application itself, not the external services you choose to
connect (AI providers, Git hosting, update feeds).

## Local-first defaults

- **Your projects stay on your machine.** Editing, indexing,
  search, planning, checkpoints, and history all run locally.
- **No telemetry.** KryomCode collects no usage analytics and
  phones home to no KryomLabs server.
- **No silent uploads.** Nothing leaves the machine except
  through the explicit network operations below.
- **Secrets stay local.** API keys live in your environment
  (see `.env.example`); they are never written to settings
  files, logs, session history, diagnostics, or AI-facing
  metadata beyond the provider calls that need them.

## Network operations (all user-initiated or provider-driven)

| Operation | Destination | Data sent | Trigger |
| --------- | ----------- | --------- | ------- |
| AI completion | Your configured provider (Meta by default) | The prompt you approve, including attached context | You run a chat/agent/research request |
| Web research | arXiv, OpenAlex, DuckDuckGo, or Tavily (if keyed) | Search queries | You start web research |
| Update check | The configured update feed, if any | Version + platform (no identity) | You click Check for updates |
| Update download | The feed's artifact host | Nothing identifying | You click Download |
| External links | The linked site | Normal browser request | You click Open / docs links |
| Git remotes | Your configured remotes | Git protocol data | You run fetch/push/pull/clone |

There is no other networking in the app. If a feature needs a
new destination, it must be disclosed here first.

## AI provider data

When you send an AI request, the provider receives your prompt
and the context you attached (files, plans, diagnostics you
approved). The provider's own privacy policy governs that copy.
KryomCode never sends your API keys to anyone except the
provider they belong to, and never sends your whole workspace
unless you explicitly attach it.

## Diagnostics export

Help → Export Diagnostics builds a local JSON bundle with
versions, platform, feature status counts, and redacted error
one-liners. You preview exactly what is included before
exporting, the home directory is replaced with `~`, and the
file is saved where you choose. It never uploads.

## Files the app writes

- Settings, sessions, plans, checkpoints, indexes: Electron
  `userData` and your project's `.kryom/` directory.
- No data is written outside those locations except files you
  explicitly create (projects, exports, generated code).

See [docs/PRIVACY.md](docs/PRIVACY.md) for the
implementation-level reference.
