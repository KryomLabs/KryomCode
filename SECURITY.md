# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| Latest stable release | Yes |
| Preview builds | Best effort (report confirmed issues against stable too) |
| Older releases | No — please upgrade and re-test |

KryomCode follows prerelease `0.x` semver while pre-1.0: minor
versions may include breaking changes, documented in
[docs/CHANGELOG.md](docs/CHANGELOG.md).

## Reporting a vulnerability

**Do not open a public issue for a suspected vulnerability.**
Use one of these private channels:

1. **GitHub Security Advisories (preferred):** open a private
   vulnerability report from the repository's **Security** tab
   (`Security → Advisories → Report a vulnerability`). This
   keeps the report visible only to maintainers until a fix
   ships.
2. If Security Advisories are unavailable in your region or
   fork, contact the repository owner privately through the
   profile listed on the
   [KryomLabs organization page](https://github.com/KryomLabs)
   and ask for a secure disclosure channel.

There is no dedicated security contact email yet; setting one
up is a documented owner action (see
[docs/RELEASING.md](docs/RELEASING.md)). The process above
works without it.

### What to include

- Affected version/commit and platform (Windows/macOS/Linux).
- Steps to reproduce with a disposable test project.
- What you expected vs. what happened.
- Whether secrets, workspace files outside the open project,
  or other users' data are reachable.

Never include real API keys, tokens, private file contents,
or private `.kryom` data in a report — redact them first and
say what you redacted.

## Response targets

- Acknowledgement: within 3 business days.
- Triage and severity assessment: within 7 business days.
- Fix or mitigation plan: communicated once triage completes;
  timelines depend on severity and scope.

## Disclosure

We follow coordinated disclosure: reporters get credit (unless
they decline), fixes ship with a changelog entry, and public
details follow the release. We ask reporters to hold public
disclosure until a fix or mitigation is available.

## Scope notes

- The extension runtime isolates each active extension in a
  dedicated child process with timeouts and memory caps, but
  it is **not** a hardened sandbox for arbitrary hostile
  code. Installing extensions you do not trust is
  explicitly out of the supported threat model — see
  [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
- AI providers receive only the prompts the user approves;
  see [PRIVACY.md](PRIVACY.md).
