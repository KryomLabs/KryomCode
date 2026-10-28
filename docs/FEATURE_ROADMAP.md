# KryomCode Feature Roadmap

Status key: **Done** means implemented in this working tree.
**Planned** means an idea only — not designed, not scheduled, and not
promised. Nothing under Planned should be treated as a commitment.

## Done — Phase 1: backend services

- Electron main process, sandboxed renderer, preload capability bridge.
- Workspace open/close/refresh with a bounded file tree.
- File read/write with a 1 MB cap, conditional saves, conflict errors.
- File and folder create/rename/delete.
- Bounded name and content search.
- Terminal runner with scrubbed env, timeouts, caps, cancel, status.
- Meta AI chat orchestration with a model allowlist and a mock provider.
- Agent plan/apply with validation, previews, and rollback.
- Git status, diff, stage, commit, push.
- Diagnostics runner with tsc/generic/stack parsers.
- Project summary and bounded AI context.
- Validated settings store with a central secret allowlist.
- 15-file `node:test` backend suite plus a wiring regression test.

## Done — Phase 2: frontend

- IDE shell: title bar, activity bar, contextual sidebar, Monaco
  center, Chat/Agent/Research center stage, right-side
  Terminal/Output panel, status bar. No bottom dock.
- Multi-file editor tabs with dirty tracking, save-conflict dialog,
  discard-changes confirmation, and keyboard navigation.
- AI chat with history, code rendering, workspace context toggle,
  model override, and key-setup guidance.
- Agent panel with plan preview diffs, open-in-editor, full
  previews, selective apply, and rollback.
- Terminal (history, auto-scroll), Problems (Monaco markers), Git
  (unstage, discard), Search, and Settings UI wired to the bridge.
- Research findings/evidence/decisions rendered with citations and
  browser opening for sources.

## Done — Phase 3: supporting files (this working tree, uncommitted)

- Repository hygiene: 34 zero-byte scaffolds and three empty directory
  trees removed, build artifacts untracked.
- Full README, `docs/` set, and backend-limitation record.
- Windows CI workflow (test, syntax check, production build).
- Windows packaging configuration (electron-builder, NSIS).

## Planned — future ideas (not committed)

- Live verification of the packaged app and both Meta models.
- Streaming terminal and diagnostics output.
- Mid-plan agent cancellation in the UI (needs an IPC cancel
  path; the provider accepts an AbortSignal but nothing wires it).
- Chat streaming, stop/cancel, and session persistence (needs new
  provider and storage contracts; the provider is single-shot).
- Additional diagnostics parsers (ESLint output, more test runners).
- macOS and Linux packaging.
- Renderer unit tests.
- Signed installers and automatic updates.

If you pick up a Planned item, move it to Done with the change that
implements it and record any manual verification in
[backend-limitations.md](backend-limitations.md).
