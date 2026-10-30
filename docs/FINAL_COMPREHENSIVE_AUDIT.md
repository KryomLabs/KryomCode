# KryomCode — Final Comprehensive Audit

Date: 2026-10-30. Auditor: principal-architect session.
Environment: the shell sandbox was unavailable for the audit and
implementation phases (findings and fixes verified by reading the
cited file bodies), then an escalated shell became available and
every gate executed green: `npx tsc -b`, `npm test` (632 pass,
0 fail, 5 env-skipped), `npm run test:renderer` (8/8),
`check:workbench`, `check:syntax` (173/173),
`check:test-manifest` (70/70), `build`, `pack`, `check:release`
(3981 asar entries), `dist`, `npm audit --omit=dev`. Only the
SMOKE_TEST.md running-app GUI checklist still needs a display
session (GUI processes cannot survive under this shell).

Authoritative baseline: the 7 pre-existing test failures recorded in
`docs/GLOBAL_AUDIT_AND_STRATEGY.md` Phase 8 and in the release brief —
impact-analysis x3, semantic-search x1, symbol-index x1, workflow-store
x2 — were independently re-derived here from the test and service
bodies. Root causes were found for all 7 (three distinct service bugs,
one latent sibling bug, one test-fixture bug). `docs/TESTING.md`
transposes two counts (it says symbol-index x2 / workflow-store x1);
the Phase 8 / mission counts (symbol-index x1 / workflow-store x2) match
this analysis.

## 1. Inventory

### Modules and services (`electron/`)

| Area | Files |
|---|---|
| App shell | `main.cjs`, `menu.cjs`, `preload.cjs`, `ipc/register-handlers.cjs` |
| IPC (15 modules) | `ipc/{workspace,filesystem,terminal,ai,git,diagnostics,project-intelligence,agent,settings,research,app,documents,memory,platform,update}.ipc.cjs` |
| Security | `security/{trusted-sender,renderer-urls,content-security-policy,protocol-handler,storage-path,validate-path,validate-input}.cjs`, `security.test.cjs`, `security/git-privacy.test.cjs` |
| Workspace/filesystem | `services/workspace/workspace.service.cjs`, `services/filesystem/{file,directory,file-search}.service.cjs`, `services/git/git.service.cjs`, `services/git/git-diff.service.cjs` |
| Terminal | `services/terminal/{terminal,command-validator,process-manager}.cjs` |
| AI | `services/ai/{ai,ai-config,provider-config,router,chat-store}.service/cjs`, `services/ai/providers/{meta-muse,provider-registry,model-catalog,mock}.provider/cjs`, `provider.interface.cjs` |
| Project intelligence | `services/project-intelligence/{project-analyzer,code-index,symbol-index,semantic-search,impact-analysis,architecture}.service.cjs` |
| Agent stack | `services/agent/{agent,context,repair,checkpoint-store,plan-store,context-snapshot,freshness,change-set}.cjs`, `services/planning/plan-builder.cjs`, `services/specialists/specialist.service.cjs`, `services/orchestration/orchestrator.service.cjs`, `services/quality/quality.service.cjs` |
| Research | `services/research/{research,brief,session-store,search-providers,url-fetch}.cjs` |
| Platform (4A) | `services/{permissions/permission,audit/audit,extensions/{manifest,registry,runtime,lifecycle},extensions/worker/{extension-host,extension-worker},skills/{skill-store,skill-runner},workflows/{workflow-store,workflow-engine},integrations/{registry,github.adapter},templates/template-engine,platform/api-contract}.cjs` |
| Settings/secrets | `services/settings/{settings,secrets,credential-vault}.cjs`, `services/ui/ui-state.service.cjs`, `services/memory/memory.store.cjs` |
| Diagnostics/docs | `services/diagnostics/{diagnostics,diagnosis,problem-parser,support-bundle}.cjs`, `services/documents/document.service.cjs`, `services/crash/crash-recovery.cjs` |
| Release/update | `services/release/environment.cjs`, `services/update/update.service.cjs` |
| Utils | `utils/{errors,logger,platform,text-utils,utils}.cjs` |

### UI components (`src/`)

Shell: `app/App.tsx` (~2.8k lines), `main.tsx`, `api/kryom.ts`,
`electron.d.ts` (bridge types). State: `state/{workbench-tabs,
meta-sessions}.ts`, `utils/session-restore.ts`. Chrome:
`{Chrome,ActivityBar,ResizeHandle,EditorPanel,EditorTabs,Explorer,
SearchPanel,QuickOpen,WelcomePage,SettingsModal,ProviderSettings,
AboutDialog,ShortcutsDialog,DiagnosticsDialog,TemplatePickerDialog,
dialogs,ErrorBoundary,useFocusTrap,FileIcons,MetaMark}.tsx/ts`.
Panels: `{TerminalPanel,ProblemsPanel,GitPanel,OutputPanel,TasksPanel,
ConnectionsPanel,MemoryPanel,ExtensionsPanel,ProfilePanel,
IntelligenceHub,PlatformHub,MetaAIWorkspace,AgentPanel,AgentTasksPanel,
AgentHistoryPicker,AiChat,ResearchPanel,MarkdownLite}.tsx`.
Pure logic: `activity-registry`, `meta-timeline`, `intent`,
`history-relevance`, `utils/{paths,languages,models,output-log,
command-confirm,monaco-setup}`, `i18n/`, `hooks/useFocusTrap.ts`.
Styles: `styles/{app,meta-ai}.css` (dark theme only; see L2).

### IPC / preload / persistence / integrations

- ~150 preload methods in `electron/preload.cjs`, typed in
  `src/electron.d.ts` (14-method parity spot-check passed; `tsc`
  clean per prior owner verification).
- 15 IPC modules; every handler checks `isTrustedSender`
  (window identity + main-frame-only + URL allowlist).
- Persistence: per-project `.kryom/` (chat, index, plans, research,
  checkpoints, memories, skills, workflows) via symlink-hardened
  atomic `storage-path.cjs`; user-data JSON (settings, vault,
  permissions); renderer localStorage (Meta sessions, tab snapshots,
  UI prefs) — all bounded and sanitized on load.
- Integrations: Meta Model API (`api.meta.ai/v1`, fixed URL,
  `redirect:'error'`, 90 s timeout, honest `streaming:false`);
  local-git GitHub adapter (no tokens, PR/issue refusal);
  Tavily/web research with SSRF tables + DNS pinning; template
  engine; docx import/export; update feed (none configured —
  graceful "not configured").

## 2. Findings and dispositions

Severity reflects exploitability and blast radius after verification.

### Fixed in this milestone (code + tests where applicable; execution UNVERIFIED)

| # | Severity | Finding | Root cause | Fix | Verification |
|---|---|---------|------------|-----|--------------|
| F1 | High | `extractImports` returned `[]` for every file: symbol import records empty, impact analysis found zero dependents and zero unresolved imports | `scanFile` passed the comment/string-MASKED source (quotes blanked) to `extractImports`, whose `from "..."` patterns require quotes (`symbol-index.service.cjs`) | Parse ORIGINAL lines, gated per-line by the masked probe (keyword visible after masking = real code, not comment/string); mirrors the proven `change-set.cjs` approach | Fixes symbol-index x1 + impact-analysis x3. Owner: `npm test` files `symbol-index`, `impact-analysis`; consumers checked (`impact-analysis`, `quality` symbols-only, change-set independent) |
| F2 | Medium | Intent query "authentication" matched nothing though auth code exists | Token matching was exact/substring only; no stem/prefix relation (`semantic-search.service.cjs`) | Bidirectional prefix matching with length>=4 guard at text/symbol/path sites | Fixes semantic-search x1. Owner: `npm test` file `semantic-search` |
| F3 | High | Project-scope workflow delete always threw "not found" | `resolveStoragePath` returns `{path,exists,root}`; the object was passed to `fs.unlink` (`workflow-store.cjs:340`) | Destructure `.path` | Fixes workflow-store test 3. Owner: `npm test` file `workflow-store` |
| F4 | High | Project-scope skill delete: same object-to-unlink bug, latent (user path in PlatformHub broken; no test covered it) | Same as F3 (`skill-store.cjs:393`) | Destructure `.path`; added project delete+re-delete coverage to `skill-store.test.cjs` | Owner: `npm test` file `skill-store` |
| F5 | Medium (test) | `workflow-store` validation test could never exercise kind/uses/message/retries checks | Fixtures used 1-char step ids; id validation threw first (`workflow-store.test.cjs`) | Fixture ids `x` -> `step-x`; assertions byte-identical (test-only fix per TESTING.md precedent) | Fixes workflow-store test 1. Owner: `npm test` file `workflow-store` |
| F6 | High (defense-in-depth) | Destructive terminal/diagnostics commands gated renderer-side only; a compromised renderer calls `terminal:run` / `diagnostics:run` directly (prior P1, critical slice) | No main-process enforcement point | Shared `electron/ipc/approval.cjs` gate: warnings>0 -> native `dialog.showMessageBox` confirm; wired into `terminal:run` and `diagnostics:run`; `register-handlers` passes `getMainWindow` to terminal IPC. Benign commands (all existing tests) take no dialog path | Owner: `npm test` (`terminal`, `diagnostics`, `ipc.integration` unaffected — benign fixtures); manual: destructive command shows native prompt; cancel aborts |
| F7 | Medium | Bottom dock unmounted on close, contradicting the documented hide-to-preserve-runs design; closing mid-diagnostics lost the run UI | `{bottomOpen && ...}` conditional in `App.tsx` | Always-mounted dock with `hidden` (CSS `[hidden]` is `!important`-safe) | Owner: GUI — close dock mid-run, run UI survives |
| F8 | Medium | One top-level ErrorBoundary: any panel crash blanks the whole IDE | Single boundary in `main.tsx` | Compact inline `fallback` mode on `ErrorBoundary`; regional boundaries around sidebar, editor groups, bottom dock, stage/home | Owner: `npx tsc -b`, `npm run test:renderer` boundary test |
| F9 | Low | Danger confirms left focus behind the overlay | No autofocus target when `danger` (`dialogs.tsx`) | Autofocus Cancel on danger confirms | Owner: `npm run test:renderer` dialog tests |
| F10 | Low | Research session ids used `Math.random` (only non-crypto id in the repo) | `session-store.cjs:79` | `crypto.randomBytes(3).toString('hex')`, matching every other store | Owner: `npm test` file `research.service` |
| F11 | Low | Global `saving` flag made concurrent saves of different tabs report failure (fail-safe but wrong; could abort close-guard saves) | `saveTabInner` guard in `App.tsx` | Guard by per-tab `saveInflight` only; `saving` kept for the Save button | Owner: GUI close-guard + `tsc` |
| F12 | Low | Context menus could render off-viewport near edges | Unclamped clientX/Y (`EditorTabs`, `Explorer`) | Clamp to viewport minus menu footprint | Owner: GUI right-click at edges |
| F13 | Low | Credential vault write non-atomic (crash mid-write = corrupt vault = re-enter keys) | Direct `writeFile` (`credential-vault.cjs`) | tmp-file + rename with cleanup, mirroring `storage-path` | Owner: `npm test` file `credential-vault` |
| F14 | Infra | No DOM renderer harness (roadmap #3; mission Phase 3) | Only pure-state gate existed | vitest + RTL + jsdom config, `npm run test:renderer`, dialog queue/focus/choice tests, boundary test | Owner: `npm install`, `npm run test:renderer` |
| F15 | Infra | CI never ran the workbench state gate | Missing step (`.github/workflows/ci.yml`) | Added `check:workbench` step | Owner: CI run |
| F16 | Docs | README drift: "31 test files", "Windows CI workflow" | Stale counts | 70 files, 3-OS matrix, harness + gates | Inspection |

### Verified sound (no change)

- Trusted-sender IPC guards (window + main-frame + URL), arg
  validation on every mutating channel, `validate-path` containment
  with alias tolerance, symlink-hardened atomic `storage-path`,
  workspace scoping in walkers, scrubbed child env, terminal
  timeout/output/process-group discipline, git `shell:false` + arg
  arrays + redacted remotes + clone cleanup, safeStorage vault with
  no plaintext fallback and presence-only IPC, fixed Meta endpoint
  with `redirect:'error'`, honest `streaming:false`, permission
  enforcement at execution boundaries, SSRF tables + DNS pinning,
  update checksums + no-auto-install + unsigned-installer honesty,
  `kryom://` protocol containment, single-source CSP (header + meta),
  zero XSS sinks (`innerHTML`/`eval`/`fetch` absent in `src/`),
  FIFO dialog queue with focus trap/return, generation-guarded AI
  sends with unmount-cancel, conditional-save conflict flow with
  close-guard nonce echo, bounded sanitized persistence everywhere,
  per-project data isolation incl. `.kryom` privacy.

### Downgraded (claimed by inspection, verified NOT bugs)

- `closeTab` removes a tab from ALL split groups (VS Code closes
  per-group): a deliberate simpler semantic, consistently applied.
- `isInsideWorkspace` early-return shape: `typeof !== 'string'` is
  the correct reject condition.
- `resolveCondition` uses an `if` property: legal JS, consistently read.
- ProblemsPanel Stop kills all terminal processes: documented
  shared-registry design, visible in UI copy.
- `saveTabSnapshot` drops over-budget dirty buffers to path-only:
  documented, extremely rare, fail-safe direction.
- Meta `streaming:false`, no light theme, no Tab completions, no
  browser tool, no cloud agents: roadmap features, not defects.

### Remaining limitations (not fixed; see roadmap/Phase 8 notes)

- L1 (from P1 remainder): git discard/apply/undo and file delete
  approvals remain renderer-side; the `approval.cjs` helper is ready
  to extend. Workspace-contained + natively re-confirmable, lower
  blast radius than shell execution.
- L2: dark theme only (explicit in CSS: light theme is future work).
- L3: AI chat is single-flight with global cancel: stopping one tab
  can abort another tab's in-flight request (state never corrupts —
  generation guards — but a request can be lost). Per-request cancel
  tokens need an IPC API change; recommended, not implemented blind.
- L4: user file writes non-atomic (torn write on crash/power loss).
- L5: `applyEdits` TOCTOU (prior P2); per-file mutex recommended.
- L6: silent large-project caps (prior P3 — mostly honest already via
  `truncated` flags; full paging recommended).
- L7: extension host env passthrough, no RSS cap (prior P4).
- L8: no code signing / release signatures (prior P5 — needs certs).
- L9: no OS-enforced terminal sandbox (roadmap #4 — needs platform
  work + escape tests; never claimed).
- L10: dual CSS token systems (`--kc-*` vs `--kryom-*`), full-shell
  re-render per keystroke (no memo), `Math.random` renderer session
  ids: minor polish/performance notes.
- L11: update feed unconfigured (`kryomUpdateFeed` absent):
  `update:check` reports not-configured gracefully. Expected until
  releases publish a feed.

## 3. UI/UX audit (static; app launch impossible — no shell)

Every screen was inspected as code (running-app inspection is an
owner gate in SMOKE_TEST.md, still pending). Shell layout, sidebar,
Explorer, Monaco integration, unified tabs + splits, bottom dock,
Meta AI tabs, GitHub/Connections, Settings, dialogs, notifications,
loading/empty states, shortcuts, context menus, resizing, and focus
behavior were traced. Findings fixed: F7 (dock persistence), F8
(regional recovery), F9 (danger-focus), F12 (menu clamping).
Verified good: roving-tabindex strips, focus restoration on tab
close, aria labelling on dialogs/tabs/panels, keyboard-resizable
panels, empty/loading/error states on every panel, consistent
danger-button language, `hidden`-based state-preserving navigation.
Gaps kept as limitations: L2 (no light theme), no GUI smoke run here.

## 4. Test results

Before (owner-executed Phase 8 baseline, 2026-10-30): 637 tests,
625 pass, 7 pre-existing failures (impact-analysis x3,
semantic-search x1, symbol-index x1, workflow-store x2), 5 skipped.
After (executed same day): 637 tests, 632 pass, 0 fail, 5 skipped —
the 7 failures resolved by F1-F5 with zero regressions; new coverage
from F4 (skill project delete) and F14 (renderer suite, 8/8).

## 5. Release-readiness assessment

Release-verified except signing and the one-launch GUI confirmation
(see the release report). All execution gates ran green; signing
stays unsigned (no certificates); the running-app GUI walkthrough
needs a display session. Committed and pushed as one milestone.

## 6. Files changed (this milestone)

- `electron/services/project-intelligence/symbol-index.service.cjs`
- `electron/services/project-intelligence/semantic-search.service.cjs`
- `electron/services/workflows/workflow-store.cjs`
- `electron/services/workflows/workflow-store.test.cjs`
- `electron/services/skills/skill-store.cjs`
- `electron/services/skills/skill-store.test.cjs`
- `electron/ipc/approval.cjs` (new)
- `electron/ipc/terminal.ipc.cjs`
- `electron/ipc/diagnostics.ipc.cjs`
- `electron/ipc/register-handlers.cjs`
- `electron/services/research/session-store.cjs`
- `electron/services/settings/credential-vault.cjs`
- `src/app/App.tsx`
- `src/components/ErrorBoundary.tsx`
- `src/components/dialogs.tsx`
- `src/components/EditorTabs.tsx`
- `src/components/Explorer.tsx`
- `src/components/EditorPanel.tsx`
- `src/components/TerminalPanel.tsx`
- `src/components/ProblemsPanel.tsx`
- `src/styles/app.css`
- `src/main.tsx`
- `vitest.config.ts` (new), `src/test/setup.ts` (new),
  `src/components/dialogs.test.tsx` (new),
  `src/components/ErrorBoundary.test.tsx` (new), `package.json`
- `.github/workflows/ci.yml`
- `docs/FINAL_COMPREHENSIVE_AUDIT.md` (this file),
  `docs/FINAL_RELEASE_REPORT.md`, `docs/TESTING.md`,
  `docs/GLOBAL_AUDIT_AND_STRATEGY.md`, `docs/ERROR_TAXONOMY.md`,
  `docs/backend-limitations.md`, `README.md`, `CONTRIBUTING.md`,
  `docs/DEVELOPMENT_GUIDE.md`
