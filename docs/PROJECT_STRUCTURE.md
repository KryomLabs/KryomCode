# KryomCode Project Structure

Annotated map of the repository. Generated from the actual tree after
the Phase 3 scaffold cleanup; empty placeholder directories were
removed. IPC, service, and component maps refreshed 2026-10-30
(Level 2A.0) against the current sources.

```text
kryomcode/
├── electron/                    # Main process (CommonJS, .cjs only)
│   ├── main.cjs                 # App lifecycle, window, .env load, loadApp, close guard
│   ├── preload.cjs              # window.kryom capability bridge
│   ├── menu.cjs                 # Native application menu
│   ├── wiring.test.cjs          # Module/export/require regression net
│   ├── ipc/                     # One register module per domain (15 domains)
│   │   ├── register-handlers.cjs
│   │   ├── workspace.ipc.cjs    # workspace:open/open-file/open-path/close/refresh
│   │   ├── filesystem.ipc.cjs   # workspace:read-file/save-file, filesystem:read-meta/save-conditional/save-as/create/rename/delete, search:files
│   │   ├── terminal.ipc.cjs     # terminal:run/cancel/status/classify
│   │   ├── ai.ipc.cjs           # ai:chat/cancel, chat:save/restore
│   │   ├── agent.ipc.cjs        # agent:plan/context/apply/cancel/checkpoints/undo + plan tracking (track/plans/plan-get/step/evidence/verify/cancel/resume/complete) + impl-plan/revise/cancel + specialist-run/get/cancel/list + orch-start/advance/approve/retry/cancel/get/list
│   │   ├── git.ipc.cjs          # git:status/cancel/diff/changed-files/stage/unstage/discard/commit/push/pull/remotes/verify/clone
│   │   ├── diagnostics.ipc.cjs  # diagnostics:run + quality/get/list
│   │   ├── project-intelligence.ipc.cjs  # intelligence:summary/context + index-status/refresh/freshness + symbols/symbol/references/search/impact/architecture
│   │   ├── settings.ipc.cjs     # settings:get/update
│   │   ├── research.ipc.cjs     # research:start/status/active/list/get/brief/cancel/resume/select/rename/delete/search/export/handoff
│   │   ├── documents.ipc.cjs    # documents:export-brief/export-text/import
│   │   ├── app.ipc.cjs          # app:get-version/get-ai-status/open-external, ui:get/set/context
│   │   ├── memory.ipc.cjs       # memory:list/get/create/update/delete/delete-all/export
│   │   ├── platform.ipc.cjs     # provider:*/permission:*/audit:list/extension:*/skill:*/workflow:*/integration:*/template:* (51 channels)
│   │   └── update.ipc.cjs       # update:status/check/download/cancel/clear
│   ├── security/
│   │   ├── trusted-sender.cjs   # Own-window check for every channel
│   │   ├── validate-path.cjs    # Workspace containment, symlink rejection
│   │   ├── validate-input.cjs   # Payload guards (objects, strings, enums)
│   │   ├── storage-path.cjs     # Contained .kryom/ paths, link rejection, atomic writes
│   │   ├── content-security-policy.cjs  # Packaged + dev CSP strings
│   │   ├── protocol-handler.cjs # kryom://app protocol for packaged loads
│   │   ├── renderer-urls.cjs    # Allowed navigation targets
│   │   └── security.test.cjs    # Security unit tests
│   ├── services/
│   │   ├── workspace/           # Root state, isInsideWorkspace, buildTree (+test)
│   │   ├── filesystem/          # file.service, directory.service, file-search.service (+tests)
│   │   ├── terminal/            # terminal.service, process-manager, command-validator (+test)
│   │   ├── ai/                  # ai.service, ai-config.service, chat-store (+tests), provider-config, router (+tests)
│   │   │   └── providers/       # provider.interface, meta-muse.provider (+test), mock.provider, provider-registry, model-catalog (+tests)
│   │   ├── agent/               # agent.service: planTask, applyEdits; context.service; checkpoint-store; plan-store: tracked plans + verification reports; context-snapshot: provenance snapshots (+tests)
│   │   ├── git/                 # git.service, git-diff.service (+test)
│   │   ├── diagnostics/         # diagnostics.service, problem-parser, support-bundle (+tests)
│   │   ├── project-intelligence/ # project-analyzer.service, dependency-analyzer.service (+test) + code-index, symbol-index, semantic-search, impact-analysis, architecture (+tests)
│   │   ├── planning/            # plan-builder: evidence-grounded decomposition + revisions (+test)
│   │   ├── specialists/         # specialist.service: 6 agents, detached runs (+test)
│   │   ├── orchestration/       # orchestrator.service: approved-plan runs, owned-file merges (+test)
│   │   ├── quality/             # quality.service: computed quality reports (+test)
│   │   ├── settings/            # settings.service (+test), secrets.service (MODEL_API_KEY allowlist)
│   │   ├── research/            # research.service, session-store, brief.service, search-providers, url-fetch.service, depth-profiles, planner, evidence, credibility (+tests)
│   │   ├── documents/           # document.service: .docx export/import (+test)
│   │   ├── ui/                  # ui-state.service: auto-save, recents (+test)
│   │   ├── crash/               # crash-recovery: pure recovery policy (+test)
│   │   ├── memory/              # memory.store: typed records + provenance + staleness (+test)
│   │   ├── permissions/         # permission.service: 12 grants + trust levels (+test)
│   │   ├── audit/               # audit.service: secret-free event log (+test)
│   │   ├── extensions/          # manifest, registry, runtime (vm sandbox), lifecycle, worker/ (isolated host + child) (+tests)
│   │   ├── skills/              # skill-store, skill-runner, builtin/ (+tests)
│   │   ├── workflows/           # workflow-store, workflow-engine, builtin/ (+tests)
│   │   ├── integrations/        # registry, github.adapter (local git) (+tests)
│   │   ├── templates/           # template-engine, builtin/ starters (+test)
│   │   ├── platform/            # api-contract: versioned public API (+test)
│   │   ├── release/             # environment: dev/preview/production detection (+test)
│   │   └── update/              # update.service: feed checks, staged verified downloads (+test)
│   └── utils/                   # errors.cjs (coded errors), logger.cjs (redacting, levels), platform.cjs (OS adapter) (+tests)
├── src/                         # Renderer (React + TypeScript)
│   ├── main.tsx                 # React root, imports styles/app.css
│   ├── electron.d.ts            # KryomAPI + payload/response interfaces
│   ├── vite-env.d.ts            # Vite client types
│   ├── api/kryom.ts             # kryom() bridge accessor, errorMessage, isWriteConflict
│   ├── app/App.tsx              # IDE shell: layout, editor state, saves, dialogs
│   ├── components/              # One panel per file (see below)
│   ├── styles/app.css           # Single global stylesheet (do not split)
│   ├── utils/                   # diff.ts (line diff), languages.ts, paths.ts
│   ├── i18n/                    # locales/en.ts + core (locale detection, t(), Intl helpers)
│   └── hooks/                   # useFocusTrap.ts (dialog focus management)
├── scripts/
│   └── check-backend-syntax.cjs # node --check gate over electron/**/*.cjs
├── sdk/                         # kryom.d.ts (public extension types) + README usage guide
├── examples/hello-command/      # Working sample extension (manifest + main.js + README)
├── docs/                        # This documentation set
├── .github/workflows/ci.yml     # Windows CI: npm ci, test, syntax, build
├── public/                      # Vite static assets (served as-is)
├── index.html                   # Renderer entry (root div + /src/main.tsx)
├── vite.config.ts               # React plugin, relative base './' for file:// builds
├── tsconfig.json                # Strict TS, bundler resolution, include src only
├── package.json                 # Scripts, deps, electron-builder "build" config
├── package-lock.json            # Reproducible installs (npm ci in CI)
├── .env.example                 # Placeholder-only env template (copy to .env)
├── .editorconfig                # 2-space, LF, trim whitespace
├── .gitignore                   # Dependencies, build output, secrets, release dirs
├── LICENSE                      # MIT (KryomLabs, 2026)
└── README.md                    # User-facing overview and commands
```

## Renderer components (`src/components/`)

| File | Backend bridge calls used (via `kryom()`) |
|---|---|
| `AboutDialog.tsx` | None directly (props from `App.tsx`) |
| `ActivityBar.tsx` | None directly (renders `activity-registry.ts`; callbacks to `App.tsx`) |
| `activity-registry.ts` | None (pure navigation registry; future modules register here) |
| `AgentPanel.tsx` | `planAgentTask`, `getAgentContext`, `applyAgentEdits`, `cancelAgentPlan`, `listCheckpoints`, `undoCheckpoint`, `searchFiles`, `readFileMeta`, `getWorkspaceSummary`, `runDiagnostics`, `getAIStatus` (+ `historyContext` prop: selected history appended to planned task as a delimited block) |
| `AiChat.tsx` | `askAI`, `cancelAI`, `saveChat`, `getWorkspaceContext`, `getAIStatus` (Discovery Chat in `WelcomePage.tsx`) |
| `AiKeyNotice.tsx` | None directly (props from `App.tsx`) |
| `Chrome.tsx` | None (pure layout) |
| `ConnectionsPanel.tsx` | `getAIStatus`, `gitStatus`, `gitRemotes`, `gitVerify`, `cancelGit`, `importDocx` |
| `dialogs.tsx` | None (confirm/prompt/conflict dialogs) |
| `DiagnosticsDialog.tsx` | `previewSupportBundle`, `exportSupportBundle` |
| `EditorPanel.tsx` | None directly (one group: Monaco view or `MetaAIWorkspace`; `App.tsx` saves) |
| `EditorTabs.tsx` | None directly (unified code/Meta AI strip; props from `App.tsx`) |
| `Explorer.tsx` | None directly (create/delete/rename via `App.tsx` handlers) |
| `ExtensionsPanel.tsx` | `getAIStatus`, `gitStatus` (capability probes; built-in list only) |
| `FileIcons.tsx` | None (pure icons) |
| `GitPanel.tsx` | `gitStatus`, `gitDiff`, `gitStage`, `gitUnstage`, `gitDiscard`, `gitCommit`, `gitPush`, `gitPull`, `cancelGit` |
| `MetaAIWorkspace.tsx` | `askAI`, `cancelAI`, `getAIStatus`, `getWorkspaceContext`, `getAgentChatExcerpt`, `getResearchBrief` + `listProviderModels` via `useMetaWorkspace` (Agent tab: conversation + embedded `AgentPanel` + `ResearchPanel` + `AgentHistoryPicker` + bottom `AgentTasksPanel`; Work Summary / History composer controls) |
| `meta-timeline.ts` | None (pure timeline builder + error classifier) |
| `MetaMark.tsx` | None (pure Meta AI infinity mark) |
| `IntelligenceHub.tsx` | `getIndexStatus`, `refreshIndex`, `searchProject`, `analyzeImpact`, `analyzeArchitecture`, `buildImplPlan`, `reviseImplPlan`, `cancelImplPlan`, `runSpecialist`, `getSpecialistRun`, `cancelSpecialistRun`, `listSpecialistRuns`, `startOrchRun`, `advanceOrchRun`, `approveOrchTask`, `retryOrchTask`, `cancelOrchRun`, `getOrchRun`, `listOrchRuns`, `buildQualityReport` |
| `PlatformHub.tsx` | `listProviders`, `getProviderSelection`, `configureProvider`, `listProviderModels`, `testProvider`, `listExtensions`, `getExtension`, `pickExtensionDirectory`, `installExtension`, `enableExtension`, `disableExtension`, `activateExtension`, `deactivateExtension`, `uninstallExtension`, `runExtensionCommand`, `listSkills`, `getSkill`, `deleteSkill`, `setSkillEnabled`, `runSkill`, `listWorkflows`, `getWorkflow`, `deleteWorkflow`, `startWorkflow`, `advanceWorkflow`, `approveWorkflow`, `resumeWorkflow`, `cancelWorkflow`, `getWorkflowRun`, `listWorkflowRuns`, `listIntegrations`, `getIntegrationStatus`, `connectIntegration`, `disconnectIntegration`, `listIntegrationRepositories`, `getIntegrationHistory`, `listTemplates`, `getTemplate`, `pickTemplateDestination`, `previewTemplate`, `generateTemplate`, `listPermissions`, `listPermissionGrants`, `grantPermission`, `revokePermission`, `listAuditEvents`, `getUpdateStatus`, `checkForUpdates`, `downloadUpdate`, `clearStagedUpdate` |
| `MarkdownLite.tsx` | None (pure rendering, no HTML injection) |
| `MemoryPanel.tsx` | `listMemories`, `getMemory`, `createMemory`, `updateMemory`, `deleteMemory`, `deleteAllMemories`, `exportMemories` |
| `OutputPanel.tsx` | None directly (props from `App.tsx`) |
| `ProblemsPanel.tsx` | `runDiagnostics`, `cancelCommand`, `classifyCommand` |
| `ProfilePanel.tsx` | None directly (props from `App.tsx`) |
| `ProviderSettings.tsx` | `listProviders`, `getProviderSelection`, `configureProvider`, `listProviderModels`, `testProvider`, `getProviderKeyStatus`, `setProviderKey`, `removeProviderKey`, `getAIStatus` |
| `QuickOpen.tsx` | None directly (works over the `App.tsx`-owned tree) |
| `ResearchPanel.tsx` | Deep Research workspace (Overview/Plan/Sources/Evidence/Findings/Report tabs): `listResearch`, `searchResearch`, `getResearchStatus`, `getActiveResearch`, `startResearch`, `cancelResearch`, `resumeResearch`, `selectResearch`, `renameResearch`, `deleteResearch`, `exportResearch`, `handoffResearch`, `exportBriefDocx`, `saveAs`, `openExternal`, `listProviderModels` |
| `ResizeHandle.tsx` | None (pure layout) |
| `SearchPanel.tsx` | `searchFiles` |
| `SettingsModal.tsx` | `updateSettings` (embeds `ProviderSettings`) |
| `ShortcutsDialog.tsx` | None (static list) |
| `TasksPanel.tsx` | `listAgentPlans`, `listOrchRuns`, `listQualityReports` |
| `AgentTasksPanel.tsx` | `getAgentPlan`, `getResearch`, `listOrchRuns` (session bottom panel: plan steps, changed files, approvals, verification, errors; read-only) |
| `AgentHistoryPicker.tsx` | `listResearch`, `getAgentChatExcerpt` (browse/search/attach project chat, research, same-root agent sessions; rank via `history-relevance`) |
| `TemplatePickerDialog.tsx` | `listTemplates`, `pickTemplateDestination`, `previewTemplate`, `generateTemplate` |
| `TerminalPanel.tsx` | `runCommand`, `cancelCommand`, `getTerminalStatus`, `classifyCommand` |
| `WelcomePage.tsx` | None directly (Discovery host: embeds `AiChat` + `ResearchPanel`) |
| `useMetaWorkspace.ts` | `listProviderModels` (model catalog for the Agent tab picker) |
| `intent.ts` | None (pure `classifyIntent` chat/research/agent router) |
| `history-relevance.ts` | None (pure token-overlap ranker for history candidates) |

`src/state/workbench-tabs.ts` is the unified tab model (code,
meta-ai, extension) with editor groups; `src/state/meta-sessions.ts`
is the independent Meta AI session store.

`src/app/App.tsx` owns workspace state, the workbench (tabs/groups),
Meta AI sessions, save and conflict flows, and explorer mutations;
panels own only their own UI state. All backend calls go through
`kryom()` from `src/api/kryom.ts`
so a missing bridge fails loudly.

Two bridge methods are exposed, covered by the wiring test, but not
currently called by the UI: `readFile` (the UI reads through
`readFileMeta` instead) and `gitChangedFiles` (the UI derives file
lists from `gitStatus`). They remain part of the documented preload
contract.

## Conventions

- Backend files are CommonJS with the `.cjs` extension because
  `package.json` sets `"type": "module"`.
- Backend tests are colocated (`*.test.cjs` next to the module) and run
  with the Node test runner; see [TESTING.md](TESTING.md).
- `dist/`, `release/`, `out/`, and `node_modules/` are build artifacts
  and stay out of Git.
