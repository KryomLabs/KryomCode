// English (default) locale table. Keys are namespaced by surface;
// values use {name} interpolation. Only English ships: other locales
// are pending translators, never machine-filled placeholders.
export const en = {
  'diagnostics.title': 'Diagnostics bundle',
  'diagnostics.description':
    'Versions, platform, and feature status only — no source code, no file contents, no keys. ' +
    'Your home folder shows as ~. Nothing uploads; export saves a local file.',
  'diagnostics.close': 'Close',
  'diagnostics.export': 'Export…',
  'diagnostics.collecting': 'Collecting…',
  'diagnostics.app': 'App',
  'diagnostics.runtime': 'Runtime',
  'diagnostics.provider': 'Provider',
  'diagnostics.project': 'Project',
  'diagnostics.extensions': 'Extensions',
  'diagnostics.recentErrors': 'Recent errors',
  'diagnostics.keyMissing': '(key missing)',
  'diagnostics.noProject': 'no project open',
  'diagnostics.filesIndexed': '{count} files indexed',
  'diagnostics.extensionsActive': '{active} active / {installed} installed',
  'diagnostics.errorsRecorded': '{count} recorded',
  'diagnostics.savedTo': 'Saved to {path}',
  'diagnostics.exportedStatus': 'Diagnostics exported to {path}',
  'updates.check': 'Check for updates',
  'updates.download': 'Download {version}',
  'updates.discard': 'Discard',
  'updates.loading': 'Loading…',
  'updates.noFeed':
    'No update feed is configured for this build. Checks stay unavailable until the owner publishes one.',
  'updates.feedNote':
    'Checks the configured release feed. Downloads are checksum-verified and staged — installing stays a manual step.',
  'updates.noNotes': 'No release notes.',
  'updates.staged': 'Staged: {path} ({bytes} bytes, verified)',
  'updates.stagedNote': 'Run the staged installer yourself when ready. KryomCode never installs updates on its own.',
  'updates.versionLine': '{version} · {environment} · {channel}',
  'settings.language': 'Language',
  'settings.languageNote': 'Interface language. Only English ships today; more locales are pending.',
} as const

export type LocaleKey = keyof typeof en
