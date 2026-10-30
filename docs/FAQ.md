# Frequently Asked Questions

## What is KryomCode?

A local-first, AI-assisted desktop development environment
(Electron + React + Monaco). Its workflow is Research →
Understand → Plan → Review → Execute → Verify, with the
human approving every consequential step.

## Which AI providers work?

Meta AI models are first-class (`muse-spark-1.3` default,
`muse-wonder-1.0` optional) via `MODEL_API_KEY`. The
provider registry supports adding more providers through
the documented contract, but no second live provider ships
yet. The app never silently switches providers or models.

## Does it upload my code?

Only inside AI prompts you approve — and only the context
attached to that request. Indexing, search, planning,
checkpoints, and history all run locally. There is no
telemetry and no background uploading. See
[PRIVACY.md](../PRIVACY.md).

## Where are my keys stored?

In your environment (`.env` in development, user env in
production). Never in settings files, logs, session
history, or diagnostics. Settings screens show presence
("key missing"), never values.

## Which platforms are supported?

Windows is validated. macOS and Linux packaging is
configured but runtime testing is pending — see
[PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md) for the live
matrix.

## Are extensions safe to install?

Treat them like any third-party code: only install
extensions you trust. Each active extension runs in a
dedicated child process with timeouts and memory caps
behind explicit permission grants, but this is not a
hardened hostile-code sandbox. Installs land disabled;
nothing activates without you. See
[THREAT_MODEL.md](THREAT_MODEL.md).

## How do updates work?

PLATFORM → Updates checks a release feed on demand (none
is configured yet, so checks report unavailable). When a
feed exists, downloads are checksum-verified and staged;
you install the staged file yourself. Nothing
auto-installs, and failures leave your install untouched.

## How do I report a bug? A vulnerability?

Bugs: GitHub Issues with the bug template (attach a
redacted diagnostics export). Vulnerabilities: private
report via GitHub Security Advisories only — never a
public issue. See [SECURITY.md](../SECURITY.md).

## Can I contribute?

Yes — start with
[DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md). Tests, docs, and a
security paragraph for privileged code are required.
