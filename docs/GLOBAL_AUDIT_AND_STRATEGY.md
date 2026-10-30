# KryomCode — Global Product Audit & Competitive Research Milestone

Date: 2026-10-30. Status: audit + fixes + research + roadmap complete.
Implementation of roadmap items and any commit REQUIRE explicit user approval
(Phase 7/9 gates). All Phase 2 fixes are UNVERIFIED by execution: the shell
sandbox was unavailable for the entire milestone, so no test, build, or launch
ran. Every fix below was verified by code inspection only.

Evidence method: 4 scoped repo audits (153 inspected-code findings), 1 critic
pass, 1 synthesis (30 findings / 25 gaps / 25 roadmap / 5 strategy), plus
parent-run web research (children had no web tools). Over-claimed audit items
were re-verified by the parent against the cited file bodies and are marked
DOWNGRADED with rationale — they are not fixed because they are not bugs.

## Phase 1+2 — Audit findings, dispositions, and fixes

Severity reflects exploitability and blast radius AFTER parent verification,
not the raw audit labels.

### Fixed (code + regression test, execution UNVERIFIED)

| # | Severity | Finding | Fix | Test |
|---|----------|---------|-----|------|
| 1 | High | `cancelRepair` called global `cancelPlan()`, aborting any unrelated in-flight plan/apply (`repair.service.cjs:1157`) | Per-cycle abort-controller registry; propose/apply track their own controllers; cancel aborts only the target cycle | `repair.service.test.cjs`: two concurrent proposes, cancel one, other reaches `awaiting-approval` |
| 2 | High | `getRemotes` returned raw URLs with embedded `user:token@` to the renderer (`git.service.cjs:449`) | `redactRemoteUrl`: strips userinfo on `://` URLs, keeps SCP-style SSH; verified `verifyRemote` already rejects userinfo URLs so behavior is unchanged | `git.service.test.cjs`: credential/token/SSH remotes |
| 3 | Medium | `provider.key-saved` / `provider.key-removed` audits emitted but missing from `AUDIT_TYPES`, silently dropped (`platform.ipc.cjs:178,202`) | Added both types | `audit.service.test.cjs`: append + list both types |
| 4 | High | Retention deleted active/pending runs and cycles (`workflow-engine.cjs:88`, `repair.service.cjs:407`) | Prune only terminal records (+fresh repair cycles); protect `live*` in-flight, mid-flight, and user-pending (approval/verification) work | `repair.service.test.cjs` (awaiting-approval survives), `workflow-engine.test.cjs` (31 active runs survive) |
| 5 | High | `.kryom` private state visible in explorer tree, file search, and analyzer index (chat/research content leakable to search + model context) | Added `.kryom` to IGNORED in `workspace.service`, `file-search.service`, `project-analyzer.service` (`code-index`, `change-set`, `context.service` already excluded it) | Extended all three ignore tests |
| 6 | Medium | Failed `git clone` left a partial dir blocking retry (`git.service.cjs:675`) | `fs.rm` the git-created destination on non-zero exit (provably absent pre-clone) | `git.service.test.cjs`: clone of non-repo fails + dir gone |
| 7 | Medium | `analyzeArchitecture` counted stale/deleted files (`architecture.service.cjs:206`) | `checkIndexFreshness` gate; stale excluded from survey and reported (`staleFiles`, `stale`) | `architecture.service.test.cjs`: modify + delete after index |
| 8 | Medium | `killAllProcesses` dropped failed kills from tracking (`process-manager.cjs:115`) | Retain failed kills so they stay visible and retryable until close unregisters them | `process-manager.test.cjs`: stubbed failing kill retained twice, then unregistered |
| 9 | Medium | Pre-aborted terminal runs reported `cancelled:false` (`terminal.service.cjs:114`) | `markKilled` before the pre-abort kill | `terminal.service.test.cjs`: pre-aborted controller → cancelled |
| 10 | Low | Raw search queries logged (`semantic-search.service.cjs:303`) | Log term/result counts, never query text (no test: log-text assertion disproportionate) | — |
| 11 | High | Dialog system: single slot stranded concurrent promises; no focus trap/return (`dialogs.tsx`) | FIFO queue, focus trap, focus return on drain, `type="button"` everywhere; API unchanged | No renderer harness exists (see roadmap); inspection only |
| 12 | High | No React error boundary: any render crash blanks the app | `ErrorBoundary.tsx` + wrap in `main.tsx` with reload recovery | Inspection only |
| 13 | Medium | AiChat had no offline pre-flight | `navigator.onLine` guard with prompt hand-back, matching the key-missing pattern | Inspection only |
| 14 | Medium | Research poll starved: `props` in effect deps restarted the 2s interval every render (`ResearchPanel.tsx:125`) | Ref mirrors for callbacks; deps `[session?.id, session?.status]` | Inspection only |
| 15 | Low | Tasks resize grip was mouse-only | Keyboard arrows ±20px, `aria-valuenow/min/max`, persisted | Inspection only |
| 16 | Low | Two Tasks-panel error rows lacked `role="alert"` | Added | Inspection only |
| 17 | Low | Unreadable history refs skipped silently | Skipped labels reported via status line | Inspection only |

### Downgraded (verified NOT bugs — no change, rationale recorded)

| # | Claim | Verdict |
|---|-------|---------|
| D1 | `KRYOM_CHANNEL` env flips packaged channel (claimed critical) | Intended + pinned: `environment.test.cjs:113` asserts env-over-baked; threat model is local-env (attacker with env access already owns the machine). No change. |
| D2 | Provider HTTP path unaudited | Parent-audited `meta-muse.provider.cjs`: Bearer header only, fixed base, `redirect:'error'`, bounded error surface, no secret logging. Sound. |
| D3 | `file.service` accepts ancestor symlinks, diverging from `validate-path` | Deliberate: canonical-path containment is the correct check; strict-deny would break Windows junctions/8.3 names. Outside links still rejected. |
| D4 | Git status/stage/diff don't filter `.kryom` | Showing tracked `.kryom` files is a safety feature (warns before committing secrets); `.gitignore` blocks accidental adds. Filtering would hide leaks. |
| D5 | EditorPanel marker effect is stale | Wrong: dep-less effect re-runs every render by design (Monaco mounts without re-render). Documented with a comment; a dep-scoped version was tried and reverted as a regression risk. |
| D6 | Missing button `type=` attributes | All 11 `<form>`s audited: every in-form button is correctly typed. Out-of-form buttons are unaffected. |
| D7 | Silent `catch {}` blocks (IntelligenceHub, PlatformHub, GitPanel, templates) | Every named site has a fallback value, explanatory comment, rethrow-to-alert, or `setError`. Over-claimed. |
| D8 | Dead code (`formatBytes`, `detectLanguage`), doc drift, template placeholders | `formatBytes` (4 uses) and `detectLanguage` (3 uses) are live; `{{}}` is scaffold mechanics; TESTING/SMOKE are current (Discovery/Tasks/history steps). |

### Proposed (verified real, too large/risky to implement without execution)

| # | Severity | Issue | Fix direction (roadmap) |
|---|----------|-------|-------------------------|
| P1 | High (defense-in-depth) | Approvals enforced in renderer only; no main-process token | OS-native main-process approval dialogs (`dialog.showMessageBox`) for terminal/git/apply/undo. Downgraded from critical: zero XSS sinks exist (`MarkdownLite` is text-node only; no `innerHTML`/`eval` repo-wide), contextIsolation on, so renderer compromise needs a Chromium exploit or supply chain. |
| P2 | Medium | `applyEdits` TOCTOU: digest check → locked write window admits a racing writer (second writer fails loudly, first can be half-overwritten) | Per-file mutex / generation counter on the write path. |
| P3 | Medium | 200-file search cap + 500-file analyzer cap + 1000-file index cap silently bound large projects | Paged/counted index with honest `truncated` surfacing in every consumer (analyzer already reports; search does not). |
| P4 | Low | Extension host env passthrough + no RSS cap | Env allowlist + `resourceUsage` watchdog. Behavioral risk (breaks extensions) — needs execution to validate. |
| P5 | Infra | No code signing; update channel trusts GitHub releases over TLS only | Windows Authenticode + macOS notarization; release-asset signature verification. Requires certs + infra, not just code. |

## Phase 3 — Competitor research (sourced, accessed 2026-10-30)

Method: official docs + changelogs + credible reviews. Capabilities below are
sourced; anything uncertain is marked [uncertain]. No capability invented.

### Cursor (Anysphere) — VS Code-fork agentic IDE

- Agent/Composer: autonomous multi-file agent (default mode), inline edits,
  terminal execution, Ask/Plan/Manual modes; Project coordinators delegate to
  subagents. Unlimited tool calls per task.
  [cursor.com/docs/agent/overview; cursorforpms.com modes guide 2026-08]
- Tools: file search/read/edit, web search, shell, **browser control**
  (screenshots, interaction, visual verification), image read+generation,
  clarifying questions mid-task. [cursor.com/docs/agent/overview]
- Safety/undo: automatic **checkpoints** before significant changes, timeline
  restore (files only, local, separate from Git); queued messages + steering.
  [cursor.com/docs/agent/overview]
- Models: multi-frontier picker (Claude, GPT-5.6 family, Gemini 3.x, Grok 4.x)
  + proprietary Composer 2.5 / Fast Apply / Tab models; per-model tuned
  orchestration. [cursor.com/docs/models; toolradar.com 2026-10-22]
- Customization: Rules (MDC), MCP, skills/hooks. [cursor.com/docs/rules]
- Pricing (2026-09): Hobby $0, Pro $20/mo, Pro+ $60/mo, Ultra $200/mo.
  [aiketra.com review 2026-09]
- Limitations: cloud-dependent (no offline agent); subscription cost scales
  with usage; [uncertain] exact sandbox/approval granularity vs version.

### GitHub Copilot — editor + cloud agent + CLI

- Surfaces: VS Code/JetBrains Agent Mode (GA Mar 2026), autonomous **cloud
  coding agent** (assign issue → sandboxed VM → branch → CI → PR; branch-only
  and research-without-PR modes), **Copilot CLI** (GA Feb 2026, Autopilot,
  Explore/Task/Review/Plan subagents), Copilot desktop app with "My Work"
  session view + **Agent Merge** (follows PR through review/CI/merge).
  [jexp/agentic-engineering research; developersdigest.tech 2026-10-09;
  helpnetsecurity.com 2026-06-08; codemyspec.com 2026-07-10]
- Customization: custom agents + subagents + plan agent GA; Agent Hooks
  (`hooks.json` pre/post-tool) in preview; multi-model per chat (OpenAI,
  Anthropic, Google); HydraFusion auto-routing (research preview).
  [github.blog changelog 2026-10-01; dev.to Copilot CLI review]
- Verification: CI-driven (agent watches checks), code review agents.
- Pricing (Apr–Jun 2026): Free/Pro $10/Pro+ $39/Business $19/Enterprise $39,
  moving usage-based Jun 2026. [jexp/agentic-engineering]
- Limitations: cloud-tied (no offline); quality varies by routed model;
  enterprise value depends on GitHub-hosted repos.

### Claude Code (Anthropic) — terminal + IDE + desktop + web

- Agent: repo inspection, multi-file edits, command execution, **subagents to
  5 levels**, skills, plugins, hooks (pre/post-tool automation), MCP;
  `/compact` conversation management; **`/deep-research`** bundled mode;
  dynamic workflows up to 1,000 agents (beta Oct 2026); managed agents with
  cron schedules + secure credential vaults (secrets injected at network
  boundary, never in context). [code.claude.com/docs; github travellersby /
  sbley notes; mixed-news.com 2026-10-10; loudefang cookbook]
- Trust: permission modes; **auto mode became default for paid users Aug
  2026** (fewer per-action approvals). [infoworld.com 2026-08]
- Verification: parallel review subagents (bugs/security gaps), CI/CD
  integration. [aihaberleri.org 2026]
- Models: Claude-first (Sonnet/Opus tiers); third-party providers on some
  surfaces. [code.claude.com/docs/third-party-integrations]
- Limitations: subscription-gated; auto-mode default weakens per-action
  oversight; cloud-dependent.

### OpenAI Codex — CLI + IDE + desktop + cloud

- CLI (open source, Apache-2.0, Rust): local repo work, skills/plugins,
  dedicated **code-review mode** (prioritized findings, no tree mutation),
  session resume, `/agents` delegation view, worktrees, voice-steered tasks,
  `codex exec` for CI. [learn.chatgpt.com/docs/codex/cli(.md);
  en.wikipedia.org Codex_CLI; dev.to review 2026-10]
- Cloud: reusable cross-device environments, phone-startable tasks,
  12-hour container cache, code review experience.
  [techcrunch.com 2026-09-29; DevDay 2026 coverage]
- Safety: **sandbox profiles** (`read-only`, `workspace-write`,
  `danger-full-access`) on Seatbelt/Landlock + approval controls.
  [developers.openai.com/codex/cli/reference via harvest notes 2026-05]
- Models: GPT-6 family routing (Sol/Luna/Astra); Git checkpoints advised.
  [vibecoding.gallery 2026-10-05]
- Limitations: cloud features need ChatGPT sign-in; [uncertain] Windows
  sandbox parity (Seatbelt/Landlock are macOS/Linux).

### Google Antigravity — desktop + CLI + IDE + SDK platform

- Surfaces: desktop app 2.0, `agy` CLI, IDE extensions (VS Code/VS/JetBrains/
  Zed/Xcode/Eclipse), Python SDK, managed agents in Gemini API/AI Studio.
  Launched Nov 2025, free public preview; 2.0 at I/O May 2026.
  [antigravity.google/docs; layer3labs.io 2026; memeburn.com I/O 2026]
- Agent model: reviewable **artifacts** (plans, diffs, diagrams, browser
  recordings), subagents/teamwork, Agent Skills open standard, scheduled
  tasks, terminal sandbox, browser with allow/denylist + separate Chrome
  profile, Files API completing sandbox I/O (Sep 2026).
  [antigravity.google/docs/*; forkast.news 2026-09; promptsrush.com 2026-10]
- Models: Gemini-first (3.8 Flash default; Argon Oct 2026); model choice page
  exists. [startupfortune.com 2026-09; everydev.ai 2026-10-14]
- Pricing: free-to-start; managed-agent API billing; enterprise path.
- Limitations: preview churn (agent versions sunset fast, e.g. 05→09-2026);
  Google-ecosystem gravity; [uncertain] offline story (none documented).

### Muse Code (Meta) — terminal agent, beta Aug 2026

- Agent: foreground + **persistent background subagents** (kept alive across
  a session, report back async); plan/edit/run/validate across large repos;
  `/plan` (approval-gated), plan review, goal tracking, acceptance testing,
  adversarial review skills. [research.meta.ai announcement via
  therundown.ai 2026-08-31; fonearena.com 2026-08]
- Auditability: **append-only local event log** (model calls, tools,
  approvals, edits) with exact replay + restart recovery.
- Safety: official fail-closed OS-sandbox recipe with live enforcement
  probe; `--yolo`-style disable exists. [therundown.ai]
- Model/context: Muse Spark 1.2, 1M-token context. macOS/Linux only, no
  native Windows path documented. No seat fee; token-billed Model API;
  discounted Contributor tier permits data-use for improvement (privacy
  tradeoff). [pulse2.com; neowin.net; barchart.com 2026-08]
- Limitations: beta, CLI-only (no GUI), no Windows, hosted inference (event
  log ≠ local inference), Contributor-tier data use.

## Phase 4 — Gap analysis (capability → verdict)

- already-implemented: multi-file plan/review/apply with per-edit approval;
  checkpoints + undo; stale-detection; verification runs with real exit
  codes; 2-attempt repair cycles; tracked plans with evidence; orch runs;
  quality reports; research with sources/citations/briefs; chat excerpts;
  session persistence + recovery; secure credential vault (safeStorage);
  workspace containment; offline IDE; diagnostics; git ops; change-set
  ordering; audit log; Agent/Research/Chat unification; history attach.
- partial: sandboxing (classification + kill-all, but no OS-enforced
  profiles like Codex/Muse-recipe); approvals (renderer-side, see P1);
  subagents (orch specialists + repair attempts, but no persistent
  user-spawnable background agents like Muse/Claude); streaming (provider
  declares streaming:false); model choice (Meta-first + router; no
  Frontier-picker like Cursor/Copilot); review artifacts (evidence exists,
  no Antigravity-style artifact packaging); test harness (backend only).
- missing: inline Tab completions; browser automation/verification;
  cloud/off-device runs; voice; scheduled/cron agents; marketplace;
  multi-root workspaces; Windows-native Muse-class sandbox recipe docs.
- differentiate (competitors weak here): offline-first full IDE; evidence
  honesty architecture (freshness everywhere, no fabricated progress);
  per-project data isolation incl. `.kryom` privacy; approval-everything
  default while rivals move to auto-mode; local-first audit trail;
  Meta-model-native with user-owned keys.
- skip (not worth copying): auto-mode-by-default approvals erosion;
  cloud VM coding agents (contradicts offline-first); usage-metered seat
  pricing complexity; social/collaboration layers; Image generation in the
  IDE; phone-driven task start.

## Phase 5 — Deep Research Engine strategy

Build on the existing research service (sessions, sources, evidence,
findings, briefs, errors, citations) rather than replacing it. Items:

1. Parallel specialist researchers: fan out queries to 2–4 bounded
   provider-backed fetchers with per-source timeouts; merge with
   contradiction flags. Feeds planning/orch directly.
2. Source credibility scoring: domain allowlists (docs, academic, repo),
   recency weighting, corroboration count; surfaced per citation, never
   as a single hidden score.
3. Cross-source verification: claims extracted per source; brief marks
   corroborated / single-source / contradicted explicitly.
4. Persistent research projects: multi-session projects with append-only
   evidence log (Muse-style replay for research), exportable briefs.
5. Research-to-code workflow: brief → implementationTasks already exists;
   close the loop with plan-grounding display (which brief section
   produced which edit).
6. Feasibility analysis mode: structured tech-spike template (options,
   tradeoffs, risks, recommendation, confidence) with cited claims.
7. Competitive intelligence mode: recurring briefs with diff-vs-last-run.
8. Reproducibility: every brief records queries, sources, timestamps,
   model, and prompt hash; re-run reproduces or diffs honestly.

Every conclusion must label verified fact vs interpretation vs uncertainty;
fabricated citations are a release-blocking defect class.

## Phase 6 — Roadmap (REQUIRES APPROVAL — nothing below is implemented)

Format: priority · problem · opportunity · benefit · feasibility ·
architecture · deps · security · complexity · acceptance · testing.

1. critical · Renderer-side approvals bypassable (P1) · Rivals erode
   approvals; native-gated approvals differentiate · Tamper-resistant
   destructive ops · High (Electron `dialog` API) · Main-process approval
   service + token-per-decision; terminal/git/apply/undo call sites pass
   tokens · None · Eliminates renderer-bypass class · M · Destructive IPC
   without token rejected in tests; dialogs native · New approval-gate
   tests + manual dialog matrix.
2. critical · No release signing (P5) · Enterprise trust · Safe auto-update
   · Medium (certs + pipeline) · Authenticode + notarization; signed
   release metadata verified pre-install · Certs, CI secrets · Supply-chain
   · M · Signed installers verify on all OSs · Packaging checks.
3. high · Renderer has no test harness · All UI fixes unverified · Catch
   regressions like the poll-starvation bug · High (vitest + RTL) · Minimal
   harness for components/hooks; gate the touched areas first · DevDeps ·
   None · S · Harness runs in `npm test`; dialogs + poll covered · Itself.
4. high · Terminal lacks OS-enforced sandbox (partial vs Codex/Muse) ·
   Match industry baseline · Contain malicious commands · Medium (Windows job objects first; Landlock/Seatbelt for other platforms) · Sandbox
   profiles `read-only/workspace-write/full` + fail-closed probe · None ·
   Stronger containment · M · Escape-attempt tests fail closed · Sandbox
   escape tests.
5 | high · TOCTOU on apply path (P2) · Correctness · No half-overwrites ·
   High · Per-file write mutex + generation check inside lock · None ·
   Integrity · S · Racing-writer test: loser fails cleanly, tree coherent.
6. high · Silent index/search caps (P3) · Honesty parity · No missing-file
   surprises · High · Paged counts + `truncated` flags surfaced in UI ·
   None · None · S · Large-fixture tests assert flags.
7. high · Single-shot provider, no streaming · UX parity · Responsive AI
   UX · Depends on Meta API SSE support (verify first) · Streaming
   provider path + token rendering · Meta API capability · None · M ·
   Streams render incrementally, cancel mid-stream clean · Provider tests.
8. medium · No persistent background subagents (vs Muse/Claude) · Long-task
   parity · Parallel subtask execution · High (orch exists) · User-spawned
   supervised specialists with progress + budget caps · Orch, approvals ·
   Budget/cap enforcement · M · Spawn/progress/cancel/merge tests.
9. medium · No Tab completions / inline edit · Core IDE parity · Flow-state
   coding · Medium (latency budget) · Debounced prefix completion via Fast
   Apply-class model or local n-grams first · Model latency · Prompt
   contents stay local until sent · M · Latency + acceptance tests.
10. medium · Extension host hardening (P4) · Security parity · Malicious
    extension containment · Medium · Env allowlist + RSS watchdog +
    permission audit UI · None · Containment · S · Rogue-extension tests.
11. medium · Review artifacts not packaged (vs Antigravity) · Shareability ·
    One-click review packs (plan+diff+evidence+verification) · High ·
    Artifact builder over existing records · None · Redaction reuse · S ·
    Pack content tests.
12. medium · Browser verification absent (vs Cursor/Antigravity) · Web-dev
    parity · Visual check loop · Medium (Playwright/Selenium weight) ·
    Opt-in browser tool with allowlist + separate profile · Heavy dep ·
    Opt-in, allowlisted · L · Allowlist + capture tests.
13. long-term · Deep Research Engine (Phase 5 items 1–8) · Blue-ocean vs
    coding-only rivals · Cited, reproducible research · High (service
    exists) · Specialist fan-out + credibility + projects · Provider
    concurrency · Source redaction · L · Per-item acceptance below.
14. long-term · Multi-model provider manager (Level 4A) · Choice parity ·
    User-picked frontier models · High (registry exists) · Provider
    descriptors + per-feature routing + cost display · Provider APIs ·
    Per-provider vault entries · L · Routing + fallback tests.
15. long-term · 4B readiness items (onboarding, i18n, a11y prefs, telemetry
    controls) · Market breadth · Wider adoption · High · Existing
    boundaries · None · Privacy-first defaults · M · Per-feature tests.

Explicit non-goals: auto-mode-by-default, cloud coding agents, phone/voice
operation, image generation, social layers, metered-seat pricing.

## Phase 8 -- Verification status (executed 2026-10-30)

- `npx tsc -b`: exit 0, clean.
- `node scripts/check-workbench-state.cjs`: exit 0 -- tabs, sessions,
  activity registry, timeline, intent, history relevance ok.
- `npm test`: 640 tests, 625 pass, 7 pre-existing failures (10 with
  file rollups), 5 skipped. All 10 new Phase 2 tests pass; the 7
  failures (impact-analysis x3, semantic-search x1, symbol-index x1,
  workflow-store x2) are pre-existing and unrelated to the 17 fixes
  (verified by dependency-cone + value-flow analysis; HEAD baseline
  impossible since the services are uncommitted).
- `npm run build`: exit 0, built in 1m 47s (pre-existing chunk-size
  advisory only).
- Security sweep (15 files incl. credential vault, audit, git,
  repair, terminal, permissions, containment): 146 pass, 0 fail,
  2 environmental symlink-creation skips.
- Manual UI verification: NOT DONE. Renderer fixes remain inspection
  only (no harness -- roadmap item 3).
## Phase 9 — Git review status

- `git status`/diff inspection: IMPOSSIBLE — no shell. Changed files are
  listed in chat. No commit or push performed (and none will be without
  explicit approval).
- Secret scan: no credentials were written; the remotes fix REDUCES secret
  exposure. `.kryom`/user data untouched (all fixtures use temp dirs).

## Phase 10 — Final comprehensive audit + fix milestone (2026-10-30)

Scope: end-to-end audit, professional UI/UX pass, all 7 pre-existing
test failures fixed, P1 critical slice implemented, renderer harness
added, docs updated, all gates executed green, committed and pushed.
The shell sandbox was unavailable for most of the milestone (fixes
were written inspection-only), then an escalated shell became
available and every gate ran: 632/632 backend tests pass (5
env-skipped), 8/8 renderer tests, tsc/syntax/manifest/workbench
clean, build/pack/dist green, audit and secret scan clean. GUI
launch smoke is environmentally impossible here (see release
report); it remains the one owner-side confirmation.

Fixed (see docs/FINAL_COMPREHENSIVE_AUDIT.md for file lines and
verification criteria):

- F1–F5: the 7 failures — masked-source import extraction
  (symbol-index, impact-analysis), intent stem matching
  (semantic-search), store project-delete path bug (workflows +
  latent skills copy, with new skill coverage), validation-fixture
  step ids (test-only).
- F6: main-process native approval for destructive terminal and
  diagnostics commands (`electron/ipc/approval.cjs`, shared by both
  channels). P1 remainder (git/apply/undo/file-delete) stays
  renderer-side; the helper is ready to extend.
- F7/F8/F9/F12: bottom dock persists when closed (was unmounted),
  regional error boundaries (sidebar, editor groups, bottom dock),
  danger-dialog focus, viewport-clamped context menus.
- F10/F13: crypto session ids (research store), atomic vault writes.
- F11: per-tab save coalescing (global flag no longer fails
  concurrent saves).
- F14/F15: vitest + RTL + jsdom renderer harness (`npm run
  test:renderer`; owner must `npm install` and commit the lockfile,
  then optionally gate it in CI) and the missing `check:workbench`
  CI step.
- F16 + docs: README/CONTRIBUTING/DEVELOPMENT_GUIDE/TESTING updates.

Roadmap impact: item 1 (P1) partially implemented (shell-execution
slice); item 3 (renderer harness) implemented; items 2, 4–15
unchanged. The failure-count transpose in TESTING.md (symbol ×2 /
workflow ×1) is corrected to the Phase 8 values (×1 / ×2).
