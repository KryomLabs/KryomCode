# KryomCode Master Roadmap — Levels 2, 3, 4

Execution plan for production reliability, the intelligent coding
platform, and the open-source ecosystem. Level 1 is complete by owner
decision and is mapped here only to ground dependencies.

Companion: [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) keeps the
done-vs-idea list for individual features. This document owns leveled
milestones, dependencies, acceptance criteria, and status.

`docs/ARCHITECTURE.md` already maps processes, IPC, and data flow, so
no second architecture document was created.

## Status key

- **Verified** — implemented in this tree and confirmed by inspection
  against the cited files, with automated or documented manual
  coverage. Never claimed for behavior no one has run.
- **Partial** — implemented in part; the gap is named.
- **Missing** — no implementation found.
- **Unverified** — claimed by a repo record but not confirmable from
  inspection alone; needs a run.

Verification note (2026-10-29): statuses below rest on source
inspection plus repo records (`docs/backend-limitations.md`, CI
config, dated verification notes). No test, build, or Git command
could be executed in the authoring session (sandbox setup failure),
so every milestone gate in this document must still be run where the
toolchain works before its items move to Verified. Re-verified
2026-10-30: every 2A.0/2A.1 file-level claim below was spot-checked
against the current sources before implementation (all confirmed);
shell execution is still unavailable in this session, so gates must
run on the owner machine or CI.

## Milestone gate (applies to every milestone)

1. Inspect the touched files; state the scope.
2. Implement the smallest coherent change set plus regression tests.
3. Run focused tests, then `npm test`, `npm run check:syntax`, and
   `npm run build` — all green.
4. Run any manual checks the acceptance criteria name, on the exact
   build under test.
5. Write the milestone report (scope, files, exact results, criteria,
   security/perf/compat notes, limitations, next milestone).

## Level 1 — Complete (owner decision, not reworked)

Mapped from inspection; do not redo without defect evidence.

| Area | Status | Evidence |
|---|---|---|
| AI chat + per-project history + cancel | Verified | `electron/services/ai/`, `src/components/AiChat.tsx`, `chat-store.test.cjs` |
| Agent plan/apply, stale-digest reject, rollback | Verified | `electron/services/agent/agent.service.cjs`, `agent.service.test.cjs` |
| Research providers, safe fetch, cited briefs, handoff | Verified | `electron/services/research/`, `url-fetch.service.test.cjs`, `research-handoff.test.cjs` |
| Workspace, file editing, Monaco, terminal, Git | Verified | `electron/services/workspace\|filesystem\|terminal\|git/`, `src/` panels |
| Monaco local bundling (static) | Verified | `src/utils/monaco-setup.ts`, `package.json` (`monaco-editor`), `docs/backend-limitations.md` Level 1 gate |
| Security foundations (sandbox, IPC trust, containment, secrets) | Verified | `electron/security/`, `electron/main.cjs`, `electron/preload.cjs`, `security.test.cjs` |
| Backend suite + syntax gate + Windows CI | Verified | `package.json` test script (44 files after 3C), `scripts/check-backend-syntax.cjs`, `.github/workflows/ci.yml` |
| Documentation set | Partial | `docs/` complete but drifting (see 2A.0) |

## Level 2 — Production reliability

### 2A — Release readiness and security gaps

Depends on: Level 1. Blocks: 2B, all of Level 3.

Gate record (2026-10-30, run on the owner machine via approved
shell): `npm test` 213 tests / 209 pass / 0 fail / 4 skipped
(pre-existing environmental `t.skip`); `npm run check:syntax`
80/80 ok; `npm run check:test-manifest` 24/24 (first run caught
orphaned `electron/utils/text-utils.test.cjs`, now in the suite);
`npm run build` green (tsc + Vite, pre-existing chunk-size
warning); `npm audit --omit=dev --audit-level=high` 0
vulnerabilities; `npm run pack` + `npm run check:release` green
(3873 asar entries listed, required files present, no `.env` or
test files). 2A.0, 2A.1, 2A.2.1–2A.2.4 Verified; 2A.2.5 stays
Unverified (manual packaged install/launch + offline editor).

#### 2A.0 Documentation-record accuracy (hygiene, zero behavior change)

| # | Item | Status | Fix |
|---|---|---|---|
| 2A.0.1 | Test-file counts say 15, suite lists 24 | Verified | Update `docs/TESTING.md`, `docs/DEVELOPMENT_GUIDE.md`, `docs/CHANGELOG.md`, `docs/FEATURE_ROADMAP.md` to 24 + inventory the 9 unlisted files (incl. orphaned `text-utils.test.cjs`, added to the script by the new manifest gate's first run) |
| 2A.0.2 | Limitations doc claims SSRF DNS-rebinding unpinned | Verified | Correct `docs/backend-limitations.md`: `url-fetch.service.cjs` validates DNS and pins via undici; residual is only the undici-missing fallback path |
| 2A.0.3 | `docs/PROJECT_STRUCTURE.md` IPC/service map stale | Verified | Regenerate the map (12 IPC domains, research/documents/ui services, current components) |
| 2A.0.4 | Close-guard text says chat sessions are not saved | Verified | Fix `electron/main.cjs` dialog detail: chat history persists per project; in-flight agent/research work does not |

Acceptance: every claim in the four docs resolves to a cited file;
no behavior change; full gate green.

#### 2A.1 Security gap closure

Audited 2026-10-29 by inspection. No gaps found in: terminal
execution (`terminal.service.cjs`: contained cwd, scrubbed env,
120 s timeout, 100 KB cap, tree-kill cancel, advisory warnings);
workspace containment (`validate-path.cjs`, `storage-path.cjs`:
realpath, symlink/junction rejection, atomic storage writes);
IPC trust (`trusted-sender.cjs` + frame-URL check +
`validate-input.cjs` on every sampled channel); renderer isolation
(sandbox, `kryom://app` protocol, strict CSP, `MarkdownLite.tsx`
text-node-only rendering, no `dangerouslySetInnerHTML`); secret
handling (allowlist, scrubbed child env, redacting logger, `.env`
packaging exclusions); research URL fetching (SSRF tables, DNS
validation, pinned transport, manual redirects, bounds); Git
spawn shape (`shell: false`, `--` separators, clone choke point).

| # | Item | Status | Fix |
|---|---|---|---|
| 2A.1.1 | Git ref option-injection: `assertRef` allows leading `-`, so a crafted remote/branch (`--tags`, `--force`) reaches `git push\|pull` positionally (`electron/services/git/git.service.cjs`) | Verified | Reject leading `-` in `assertRef`; add `git.service.test.cjs` cases for dash-led remote/branch |
| 2A.1.2 | Meta provider follows redirects with `Bearer` key (`electron/services/ai/providers/meta-muse.provider.cjs`) | Verified | Set `redirect: 'error'` on the provider fetch; extend `meta-muse.provider.test.cjs` to assert the redirect policy via stub fetch |
| 2A.1.3 | Tavily search follows redirects with `api_key` body (`electron/services/research/search-providers.cjs`) | Verified | Same `redirect: 'error'` policy; extend `search-providers.test.cjs` |
| 2A.1.4 | Per-channel IPC audit record | Verified | Verify every `electron/ipc/*.ipc.cjs` handler calls `isTrustedSender` first and validates payloads; record the result in `docs/SECURITY.md` |

Accepted residuals (document, do not fix here): TOCTOU between path
validation and use (local single-user IDE); `.docx` import
decompression bounded only by the 5 MB pre-check (mammoth has no
streaming API); chat save/restore micro-race on mid-send project
switch (see 2B.2).

Acceptance: 2A.1.1–2A.1.3 fixed with regression tests naming the
attack shape; 2A.1.4 audit written; full gate green.

#### 2A.2 Release verification and dependency controls

| # | Item | Status | Fix |
|---|---|---|---|
| 2A.2.1 | `npm run pack` not exercised in CI; asar contents/exclusions asserted only by a dated manual note | Verified | Add a CI `pack` job plus `scripts/check-release-contents.cjs` asserting `dist/index.html`, `electron/main.cjs`, `electron/preload.cjs` present and `.env*`/`*.test.cjs` absent |
| 2A.2.2 | New `*.test.cjs` runs only if hand-appended to the `test` script | Verified | Add `scripts/check-test-manifest.cjs`: fail CI when a colocated test file is missing from the script |
| 2A.2.3 | No dependency audit gate (lockfile + `npm ci` exist; `dompurify` override exists) | Verified | Add `npm audit --omit=dev` (fail on high/critical) to CI; document the triage/exception process in `docs/DEVELOPMENT_GUIDE.md` |
| 2A.2.4 | Supported-platform coverage undefined (Windows-only by accident) | Verified | Publish the matrix in `README.md` + `docs/SMOKE_TEST.md`: dev + packaged support = Windows 10/11 x64, Node 22 dev; CI pins `windows-latest` + Node 22 |
| 2A.2.5 | Packaged install/launch + offline editor: manual-only, records conflict (README reports owner GUI pass; limitations doc says packaged app never launched) | Unverified | Re-run `docs/SMOKE_TEST.md` steps 1–17 + offline check on the release build; record dated results in `docs/backend-limitations.md` |

Acceptance: 2A.2.1–2A.2.4 automated in CI and green; 2A.2.5
recorded with date/build or explicitly outstanding. Unsigned
installer + no auto-update stay documented limitations.

### 2B — Recovery, permissions, and regression prevention

Depends on: 2A. Blocks: 3C (parallel agents), 4B (platform work).

Gate record 2B.1 (2026-10-30): focused crash tests 4/4;
`npm test` 217 tests / 213 pass / 0 fail / 4 skipped
(pre-existing environmental); `check:syntax` 82/82;
`check:test-manifest` 25/25; `npm run build` green. Dialog
wording verified honest by inspection (tabs do NOT persist);
live crash dialogs remain manual-only per SMOKE.

Gate record 2B.2 (2026-10-30): focused chat/workspace/research
tests green (incl. 5 new: 3 chat race, 1 previous-root, 1
interrupted-resume); `npm test` 222 tests / 218 pass / 0 fail /
4 skipped (pre-existing environmental); `check:syntax` 82/82;
`check:test-manifest` 25/25; `npm run build` green (tsc covers
the renderer-only snapshot code; behavior proved by new SMOKE
steps 15/18, owner-run).

Gate record 2B.3 (2026-10-30): focused agent/checkpoint tests
19/19 (6 new); `npm test` 228 tests / 224 pass / 0 fail / 4
skipped (pre-existing environmental); `check:syntax` 84/84;
`check:test-manifest` 26/26; `npm run build` green. Panel undo
flow proved by new SMOKE step 19, owner-run.

Gate record 2B.4 (2026-10-30): focused terminal/git/agent/
diagnostics tests green (8 new); `npm test` 236 tests / 232
pass / 0 fail / 4 skipped (pre-existing environmental);
`check:syntax` 84/84; `check:test-manifest` 26/26; `npm run
build` green. Panel cancel flows proved by SMOKE steps 5/5b/7/
14b/20, owner-run; mid-apply stop proved by backend tests only
(applies finish in milliseconds).

Gate record 2B.5 (2026-10-30): focused settings tests 7/7 (1
new); `npm test` 237 tests / 233 pass / 0 fail / 4 skipped
(pre-existing environmental); `check:syntax` 84/84;
`check:test-manifest` 26/26; `npm run build` green. Confirm
dialogs proved by new SMOKE step 5c, owner-run.

Gate record 2B.6 (2026-10-30): new `docs/ERROR_TAXONOMY.md`
(codes, IPC message contract, conventions, pinned renderer
wording); audit fixes bound all git stderr/stdout detail to 2000
chars and Meta server error detail to 500 chars via new
`boundDetail` helper (`electron/utils/errors.cjs`); focused
utils/provider/directory/wiring tests 24/24 (3 new, 1 pin
strengthened); `npm test` 240 tests / 236 pass / 0 fail / 4
skipped (pre-existing environmental); `check:syntax` 84/84;
`check:test-manifest` 26/26; `npm run build` green. No new
owner-run SMOKE steps: error wording is covered by pinned tests.

Gate record 2B.7 (2026-10-30): new
`electron/ipc/ipc.integration.test.cjs` (20 tests) registers the
real 64-channel handler tree against a stubbed Electron module +
stubbed windows: per-channel unauthorized sweep, sender-frame
validation, dialog stubs, malformed-input and service-error
propagation, terminal/research/agent/ai cancellation honesty, docs
export/import, git (skips without binary); extended
`scripts/check-release-contents.cjs` (resources/docs, inclusion
config, Monaco/bundle/css/font asar assets, `.kryom`/sourcemap/
key-material prohibitions) green on `release/win-unpacked`
(3873 asar entries). `npm test` 260 tests / 256 pass / 0 fail /
4 skipped (pre-existing environmental); `check:syntax` 85/85;
`check:test-manifest` 27/27; `npm run build` green. GUI e2e stays
the owner-run SMOKE checklist; no new SMOKE steps.

| # | Item | Status | Direction |
|---|---|---|---|
| 2B.1 | Crash recovery: no `uncaughtException`/`unhandledRejection` handling, no `render-process-gone` recovery, no relaunch path (`electron/main.cjs`) | Verified | Log + dialog + safe relaunch; renderer reload recovery that preserves persisted state; tests where headless-testable |
| 2B.2 | Session recovery: tabs + dirty buffers + agent draft/plan snapshot per project; interrupted research resumes from disk; chat race closed by root-bound saves | Verified | Persist open tabs + pending agent plan context + research run state for resume; fix the save/restore race with a send-generation guard; tests |
| 2B.3 | Durable checkpoints: per-apply records under `.kryom/checkpoints/` with digest-guarded cross-session undo; atomic rollback kept | Verified | Per-apply checkpoint record (pre-apply snapshot refs) enabling cross-session undo of an agent batch; keep the existing atomic rollback |
| 2B.4 | Reliable cancellation end-to-end | Verified | Cancellation exists per surface (terminal/ai/agent-planning/research); add a cancellation matrix test run + UI proof (SMOKE 10, 11); wire apply-phase abort to `agent:cancel` if still unexposed |
| 2B.5 | Permissions review: destructive commands need only one click after an advisory warning | Verified | Keep user-controlled execution; add explicit confirm for warning-bearing terminal/diagnostics commands and a setting to require confirm for all; tests |
| 2B.6 | Error taxonomy doc + message audit | Verified | Document coded errors (`electron/utils/errors.cjs`) + user-message conventions; fix wordings found in the audit; tests pin messages |
| 2B.7 | Integration + e2e coverage beyond unit tests and the wiring test | Verified | Headless IPC-level integration tests (register handlers against stubbed windows); scripted build-artifact checks; keep GUI e2e as the SMOKE checklist |

Acceptance: 2B.1–2B.4 demonstrated by tests + SMOKE; 2B.5–2B.7
merged with tests; full gate green. Single-window singleton and
no mid-apply cancel stay documented unless 2B.4 changes them.

## Level 3 — Intelligent coding platform

Depends on: Level 2 (3C additionally on 2B reliability proof).

### 3A — Project memory and evidence-based planning

| # | Item | Status | Direction |
|---|---|---|---|
| 3A.1 | Structured project memory with source provenance + staleness | Verified | New `electron/services/memory/` on the storage-path layer: typed records (decision, convention, fact), source refs (file+digest / chat / research / commit), stale-when-source-changes invalidation, per-project scope, privacy note; renderer UI for view/forget |
| 3A.2 | Memory privacy controls | Verified | `.kryom` stays untracked (see appendix); add in-app memory export/delete; memory content never leaves the project except inside explicit AI requests |
| 3A.3 | Evidence-based plans: reasons/notes/context-preview exist; risks, expected outcomes, progress artifacts, verification reports missing | Verified | Extend the plan schema with `risks[]`, `expectedOutcome`, step states; persist a per-plan progress artifact under `.kryom/`; persist verification reports from 3B |
| 3A.4 | Chat/research context grounding | Verified | Reuse existing context snapshot + `researchSessionId` handoff; add provenance labels on attached context |

Acceptance: memory CRUD + provenance + staleness tests; plan
schema v2 with risks/outcomes; progress + verification artifacts
persisted and rendered; full gate green.

Gate record 3A.1 (2026-10-30): new
`electron/services/memory/memory.store.cjs` (typed records, one
JSON file each under `.kryom/memory/`, service-captured
fingerprints, per-source stale/unverified reporting) with 15
tests; new `memory:list/get/create/update/delete` IPC + preload +
`MemoryPanel` sidebar view (provenance, stale badges, edit,
confirmed delete); `docs/MEMORY.md` privacy note; SMOKE step 21
(owner-run). Focused memory/ipc/wiring tests 39/39; `npm test`
276 tests / 272 pass / 0 fail / 4 skipped (pre-existing
environmental); `check:syntax` 88/88; `check:test-manifest`
28/28; `npm run build` green. Storage path verified on disk;
`.kryom/` confirmed gitignored (see Appendix A for the resolved
committed-state history).

Gate record 3A.2 (2026-10-30): `deleteAllMemories` (record files
only, per-file failure reporting, chat/checkpoints/research
preserved) + `buildExportDocument`/`exportMemoriesToFile`
(documented `kryom-memory-export` v1, validated records only,
atomic `.json` write); new `memory:delete-all`/`memory:export`
IPC (dialog-picked destination, cancellation is a normal result)
+ MemoryPanel Export/Delete-all controls with danger confirm and
honest states; `.kryom` Git audit (nothing tracked at HEAD or
origin, `f0d4f1d` untracked it, removed blobs re-audited
secret-free, Appendix A resolved) + `git-privacy.test.cjs` guard;
SMOKE step 22 (owner-run). Focused memory/privacy/ipc/wiring
tests 47/47; `npm test` 284 tests / 280 pass / 0 fail / 4
skipped (pre-existing environmental); `check:syntax` 89/89;
`check:test-manifest` 29/29; `npm run build` green. No history
rewrite, no tracked-file removal (nothing to remove).

Gate record 3A.3 (2026-10-30): new
`electron/services/agent/plan-store.cjs` (schema v2 under
`.kryom/plans/`, v1 migration, enforced step states,
verified-requires-passing-report, redacted bounded verification
reports, process-local interruption flags, terminal-only
retention) with 13 tests; planner prompt + proposal extended
(`expectedOutcome`, `risks[]`, `suggestedSteps`) with validation
tests; 9 `agent:plan-*` IPC channels + preload; AgentPanel tracks
on receipt, shows outcome/risks/progress/evidence/reports, wires
apply/verify/cancel flows without changing approvals;
`docs/PLANS.md`; SMOKE step 23 (owner-run). Focused
plan/agent/ipc/wiring tests 56/56; `npm test` 300 tests / 296
pass / 0 fail / 4 skipped (pre-existing environmental);
`check:syntax` 91/91; `check:test-manifest` 30/30; `tsc -b`
clean; `npm run build` green.

Gate record 3A.4 (2026-10-30): new
`electron/services/agent/context-snapshot.cjs` (chat excerpts,
research snapshots with brief versions, file fingerprints,
freshness re-checks) with 6 tests; `planTask` accepts explicit
`includeChat` and returns a provenance-labelled `contextSnapshot`
stored on the plan record (validated, legacy-null, context
auto-attached as review evidence, freshness on read); new
`agent:chat-excerpt` preview channel; AgentPanel gains an
include-chat toggle with preview and an attached-context section
(provenance labels, stale/missing warnings, snapshot status);
SMOKE step 24 (owner-run). Focused
snapshot/plan/agent/ipc/wiring tests 68/68; `npm test` 312 tests
/ 308 pass / 0 fail / 4 skipped (pre-existing environmental);
`check:syntax` 93/93; `check:test-manifest` 31/31; `tsc -b`
clean; `npm run build` green. No memory attach (no sender yet),
no autonomous execution.

Gate record 3B.1 (2026-10-30): new
`electron/services/agent/freshness.cjs` (`checkEditFreshness`:
current/stale/missing/inaccessible/unverified per referenced file,
size short-circuit before hashing, traversal fail-closed) gating
`applyEdits` immediately before the first write — a blocked batch
returns structured `stale[]` findings with zero writes and no
checkpoint instead of failing mid-batch; the per-edit
`assertFreshEdit` digest check stays as a race backstop. `agent:apply`
passes `stale` through; AgentPanel lists each finding
(path/status/reason), shows a nothing-written notice, keeps the
plan/evidence, offers re-plan, and marks the tracked apply step
`blocked`. Focused freshness/agent/ipc tests 53 pass / 1 skipped
(Windows symlink privilege); `npm test` 323 tests / 318 pass / 0
fail / 5 skipped (pre-existing environmental + symlink);
`check:syntax` 95/95; `check:test-manifest` 32/32; `tsc -b`
clean; `npm run build` green. No dependency analysis, diagnosis,
or repair loops (later 3B scope).

Gate record 3B.3 (2026-10-30): new
`electron/services/diagnostics/diagnosis.cjs` (`diagnoseRun` /
`sanitizeDiagnosis`): nine-category failure classifier over
executed runs with runner detection (node-test TAP + spec,
pytest, tsc, eslint, graceful unknown), confidence labels,
quoted file/line/test evidence, redacted bounded excerpts, and
stable `runId-fN` finding ids. `runDiagnostics` attaches
`durationMs` + `diagnosis` (provenance always `executed`;
cancelled/timed-out never pass); verification reports carry an
optional re-validated `diagnosis` (legacy reports load null);
`agent:plan-verify` accepts it past the trust guard; AgentPanel
shows execution summary + findings, links reports to runs, and
feeds the structured diagnosis into the repair prompt (no auto
repair). Focused diagnosis/diagnostics/plan/ipc tests 78/78;
`npm test` 352 tests / 347 pass / 0 fail / 5 skipped
(pre-existing environmental + symlink); `check:syntax` 97/97;
`check:test-manifest` 33/33; `tsc -b` clean; `npm run build`
green. Real `node --test` children cannot run inside the suite
(runner recursion guard); executed-path coverage uses synthetic
child programs. No repair loops (3B.4 scope).

Gate record 3B.4 (2026-10-30): new
`electron/services/agent/repair.service.cjs`: backend repair
cycles (`.kryom/repairs/<id>/cycle.json`, retention 20) move the
renderer retry loop server-side — max 2 proposals per cycle, one
fixed 10-minute budget that never resets (aborts the model call
itself), per-cycle mutex so a racing cancel wins
deterministically, and every attempt persisted as a linked
verification report (`report.repair`, optional, legacy-null).
Review-first approval preserved (proposal reviewed in the agent
panel, explicit apply/deny); freshness, checkpoints, undo, and
the confirmed verify command all reused, never bypassed.
Terminal states: passed/exhausted/expired/cancelled/
approval-denied/stale/checkpoint-failed/error, each with a
stored reason; interrupted cycles are cancel-only, never
auto-resumed. Six `agent:repair-*` channels; AgentPanel shows
state/attempts/elapsed/budget/changed files/stop reason with
start/propose/deny/cancel controls, and the cycle id survives
reload via the agent draft. Focused repair 17/17, plan-store
18/18, IPC 28/28; `npm test` 371 tests / 366 pass / 0 fail / 5 skipped
(pre-existing environmental + symlink); `check:syntax` 99/99;
`check:test-manifest` 34/34; `tsc -b` clean; `npm run build`
green. One pre-fix full-suite flake (2 repair tests, single
run, unreproduced in 11 green runs after the serialization
fix) is recorded in the milestone report. No auto repair:
every step needs a user gesture.

Gate record 3B.5 (2026-10-30; automated gates owner-confirmed
green — focused suites, `npm test`, `npm run check:syntax`, `npm
run check:test-manifest`, `tsc -b`, `npm run build`, `npm run
check:release`, all passing with exact counts not recorded here;
GUI smoke remains manual): verification
reports now separate execution facts (observed-run registry:
command, timestamps, duration, exit code, cancelled/timed-out,
source), observed evidence (redacted output excerpt, persisted
diagnosis, repair checkpoint + changed files), display-only model
explanations (bounded, redacted, never consulted for status), and
unverified claims (stated reasons, legacy provenance). Conclusions
`passed/failed/cancelled/timed_out/blocked/skipped/not_executed`
derive from observed facts only — claims must match the run or the
report is rejected; renderer execution facts are never trusted and
repair linkage stays server-derived (the IPC boundary does not
forward it). Plan-level state is conclusion-based: only executed
failures fail a plan, skipped/blocked checks leave it unverified.
New: `runDiagnostics` accepts an optional validated `timeoutMs`
(default unchanged, no IPC change) enabling a fast real-timeout
test. AgentPanel shows Status prominently with Executed /
Observed-evidence / Model-explanation (AI-generated, not evidence)
/ unverified-claim sections plus per-finding lines and repair
checkpoint/changed-files. Three new `plan-store.test.cjs` cases
(real timeout, checkpoint/file linkage + legacy repair shape,
skipped/blocked plan truthfulness) join the existing 3B.5 suite
(contradicting claims, missing execution, exit-code mismatch,
cancelled runs, secret redaction, legacy loading, tampered/
truncated recovery, duplicate/stale run ids); repair full-cycle
and exhaust tests now pin report checkpoint/file linkage. No new
execution surfaces, no new dependencies. Deferred: structured
per-runner test counts (no parser produces them; diagnostics and
finding counts are the available structured counts).

Gate record 3B.6 (2026-10-30; automated gates owner-confirmed
green — focused `change-set` suite, `npm test`, `npm run
check:syntax`, `npm run check:test-manifest`, `tsc -b`, `npm run
build`, `npm run check:release`, all passing with exact counts not
recorded here; GUI smoke remains manual): new
`electron/services/agent/change-set.cjs`
(`buildChangeSet`, read-only) parses static JS/TS imports
(import/export/require/dynamic, comment- and string-aware, no new
dependencies), resolves relative specifiers through the existing
containment validator, and returns a versioned manifest — per-file
fingerprints, resolved/unresolved/unknown/external edges, cycles,
conflicts, review groups, dependencies-first order, and whole-set
validation. Statuses: supported JS/TS analyzed; other languages
unsupported; aliases/absolute/unresolvable reported unknown, never
guessed; node_modules/.git/.kryom/secrets/generated never
entered. Freshness owns target blockers (stale/missing/
inaccessible/unverified); same-file conflicts and deletes with
confirmed in-set or external importers block; cycles, truncation,
and unresolved/unknown warn only and keep plan order. New
`agent:change-set` channel (trust guard + boundary validation);
the agent panel shows the manifest at review, disables Apply on
blockers, revalidates with a stale-dependency baseline before the
confirm dialog, applies in manifest order, and attaches the order
as apply-step note evidence. No apply-path changes: approval,
containment, freshness gate, checkpoints, undo, rollback,
cancellation, and repair caps/budgets are reused untouched;
verification stays whole-project with truthful-report semantics.
Repair flow intentionally unchanged (verified 3B.4). New
`change-set.test.cjs` (20 tests: detection, forms, cycles,
unsupported/unresolved, missing/stale, conflicts, baselines,
delete importers, ordering, validation, bounds, isolation,
ordered-apply + undo) registered in the test script, wiring test,
and IPC integration tests. Deferred:
tsconfig-paths alias resolution, non-JS/TS parsers (repair-flow
ordering landed in 3B.7).

Gate record 3B.7 (2026-10-30; automated gates fully green on
owner re-run — `npm test` 413 tests, 408 pass, 0 fail, 5 skipped
(environment symlink skips); `check:syntax` 101 ok;
`check:test-manifest` 35/35; `tsc -b` ok; `npm run build` ok
(chunk-size warning only); `check:release` ok. GUI smoke still
manual and unconfirmed, so this row stays Partial, not Verified.
History: first owner run was 415/379/31/5 with all 31 failures
traced to one 3B.7 defect — the new applyEdits conflict gate
referenced `root`, which is not in scope there; fixed by
resolving the display path from the imported `getWorkspaceRoot`
with no test changes needed): five integration gaps closed
without rebuilding verified milestones. (1) `applyEdits` refuses same-file duplicate
batches with zero writes and no checkpoint, returning structured
`conflicts` (shared `canonicalTargetKey` identity with the
change-set analyzer; renderer lists them like stale findings).
(2) `applyRepair` builds a change-set manifest per attempt:
conflict/delete-dependent blockers (new machine-readable blocker
`kind`) return to awaiting-approval unconsumed, freshness still
flows to the terminal stale mapping, manifest failures fall
through to canonical errors, and attempts apply in
dependencies-first order. (3) `recordRepair` rejects cancelled
and timed-out runs before any state moves — verdict-less runs no
longer consume attempts; the time budget still bounds re-runs.
(4) The agent verification section gains a Stop button (shared
terminal-registry kill, same tradeoff as the Problems panel) and
cancelled/timeout wording distinct from failed. (5) The context
snapshot view shows the research session status and warns when it
is not completed. Seven new tests (apply conflicts, repair
conflict/order/verdict, registry-cancelled diagnostics, blocker
kinds, IPC conflicts); no new test files, channels, or
dependencies. Performance inspected: no genuine bottleneck found
(all walks and analyses bounded; no cache added to avoid
staleness risk).

### 3B — Verify-and-repair workflow

Existing base: renderer verification runner with explicit approval,
`runDiagnostics` honesty (`success` = exit 0 + no timeout),
bounded repair (2 attempts, `AgentPanel.tsx`), stale-digest plan
rejection, atomic batch rollback.

| # | Item | Status | Direction |
|---|---|---|---|
| 3B.1 | Stale-file detection and change awareness (pre-apply freshness gate, structured `stale[]`, renderer warnings, blocked-step recovery) | Verified | Gate record 3B.1 above; follow-ups landed in 3B.6 (dependency-ordered apply) and 3B.7 (conflict gate) |
| 3B.2 | Per-edit digest reject at apply | Verified | Superseded as the primary guard by the 3B.1 pre-apply gate; `assertFreshEdit` kept as the per-edit race backstop |
| 3B.3 | Structured test diagnosis (nine-category classifier, runner detection, confidence, persisted on reports, attached to the repair prompt) | Verified | Gate record 3B.3 above; diagnosis only — repair loops stay in 3B.4 |
| 3B.4 | Bounded repair loop as a backend workflow with persisted reports | Verified | Gate record 3B.4 above; 2-attempt cap + 10-minute budget + per-attempt linked reports + 8 terminal states, approval-first |
| 3B.5 | Truthful verification reports | Verified | Gate record 3B.5 above; automated gates owner-confirmed green (counts not recorded); GUI smoke still manual |
| 3B.6 | Dependency-aware multi-file execution (read-only import graph, change-set manifest, ordered apply) | Verified | Gate record 3B.6 above; automated gates owner-confirmed green (counts not recorded); GUI smoke still manual |
| 3B.7 | Integrated Workflow Hardening | Partial | Gate record 3B.7 above; automated gates green (408 pass, 0 fail, 5 env-skipped), GUI smoke still manual and unconfirmed — flips to Verified only after manual confirmation |

Acceptance: 3B suite (bug-fix fixtures incl. failing→passing),
diagnosis accuracy recorded, reports persisted; full gate green.

### 3C — Intelligent coding platform

Scope note (2026-10-30): this section was redefined by the Level
3C master task into five milestones (3C.1–3C.5) below, replacing
the earlier three-row sketch. Mapping: old 3C.1 (read-only review
agents) is subsumed by new 3C.3 (security reviewer, independent
reviewer, testing and debugging specialists — all read-only except
the coding specialist, which only proposes); old 3C.2 (isolated
parallel agents) is subsumed by new 3C.4 (proposals-only isolation
with owned-file merge — no worktrees; the workspace singleton
still rules out concurrent disk writes, so parallelism covers
proposal generation only); old 3C.3 (benchmark suite) is deferred
to a later milestone (no `benchmarks/` harness in this tree).
Structure 3B → 3C → 4A → 4B is preserved; no levels were added.

Gate record 3C (2026-10-30, implementation session): all five
milestones implemented in this tree with colocated tests, IPC
wiring, renderer integration (INTEL stage), and docs. No automated
gate could be executed in the authoring session (sandbox setup
failure — shell unavailable), so every row below stays Partial
until the owner machine or CI runs: focused suites, `npm test`,
`npm run check:syntax`, `npm run check:test-manifest`, `npx tsc
-b`, `npm run build`, `npm run check:release`, plus SMOKE steps
25–29. GUI smoke remains manual.

Gate evidence 3C (2026-10-30, verification session): the full
automated suite is green on the owner Windows machine
(owner-confirmed; exact totals unrecorded — the pasted tail
scrolled, but every visible suite passed with only the 4
pre-existing symlink-EPERM environment skips). Supporting gates
from pasted output: `check:syntax` 170/170 ok, `npx tsc -b`
silent (clean), `npm run build` via pack (1332 modules),
`npm run pack` + `npm run check:release` green (3973 asar
entries), focused suites runtime 8/8, github-adapter 4/4,
provider-config 5/5, router 7/7, ipc.integration 44/44.
Four verification defects were found and fixed (see 4A gate
record); none weakened a test. Rows stay Partial until SMOKE
steps 25–29 are manually confirmed, per the 3B.7 precedent.

| # | Item | Status | Direction |
|---|---|---|---|
| 3C.1 | Deep project intelligence: persistent code index with fingerprints + incremental refresh + staleness reporting, JS/TS symbol/reference index, deterministic semantic search (exact/text/symbol/structural with explained scores), relative-import impact analysis with evidence, evidence-backed architecture analysis | Partial | `electron/services/project-intelligence/code-index|symbol-index|semantic-search|impact-analysis|architecture.service.cjs` + tests; 9 `intelligence:*` IPC channels; suite green 2026-10-30 (owner run), SMOKE 25–29 manual pending |
| 3C.2 | Intelligent planning: requirement → validated decomposition (files, dependencies, verification, completion), topological ordering, parallel-wave analysis, shared-file sequencing, qualitative risks, revision as a new linked record preserving completed work | Partial | `electron/services/planning/plan-builder.cjs` + test; `agent:impl-plan[-revise/-cancel]` channels; persists via plan-store v2; suite green 2026-10-30 (owner run), SMOKE 25–29 manual pending |
| 3C.3 | Specialist agents: research, coding (proposes only), testing, debugging, security, independent review — shared runner, structured I/O, per-run timeout/cancel, detached start with persisted records | Partial | `electron/services/specialists/specialist.service.cjs` + test; `agent:specialist-*` channels; Meta-first provider reuse; suite green 2026-10-30 (owner run), SMOKE 25–29 manual pending |
| 3C.4 | Controlled multi-agent orchestration: approved-plan-only runs, declared file ownership, parallel proposals (max 2) with sequential guarded merges, per-task approval, conflict/stale rejection, retry budgets, recovery with preserved history | Partial | `electron/services/orchestration/orchestrator.service.cjs` + test; `agent:orch-*` channels; no concurrent disk writes by design; suite green 2026-10-30 (owner run), SMOKE 25–29 manual pending |
| 3C.5 | Advanced quality intelligence: computed regression/test/security/performance evidence with quoted findings and an explainable verdict (no invented scores) | Partial | `electron/services/quality/quality.service.cjs` + test; `diagnostics:quality[-get/-list]` channels; suite green 2026-10-30 (owner run), SMOKE 25–29 manual pending |

Acceptance: architectural questions answered with project
evidence; complex tasks produce reviewable dependency-aware plans;
specialists return structured results through the existing
workflow; orchestration merges independent work safely with human
review of conflicts; quality reports separate findings,
recommendations, risks, and verified results; full gate green.

## Level 4 — Extensible platform and ecosystem

### 4A — Extensible platform and developer ecosystem

Scope note (2026-10-30): this section was redefined by the Level
4A task into eight milestones (4A.1–4A.8) below, replacing the
earlier six-row sketch. Mapping: old 4A.1 (provider interface) is
subsumed by new 4A.1 (stable provider platform — Meta-first
registry, catalog, routing, selection-only config); old 4A.2
(stable plugin interfaces) is subsumed by new 4A.2/4A.3/4A.6
(permissioned extension runtime, skills/workflows, versioned API +
SDK); old 4A.3–4A.6 (contributing docs, disclosure SLA,
versioning/release notes, reproducible builds) are out of the
Level 4A task scope and carry forward as deferred open-source
hygiene — they are not deleted, they are waiting on a docs/release
pass after 4B. Structure 3B → 3C → 4A → 4B is preserved; no levels
were added. Level 4B was not implemented in this task.

Gate record 4A (2026-10-30, implementation session): all eight
milestones implemented in this tree with colocated tests, IPC
wiring (51 `provider|permission|audit|extension|skill|workflow|
integration|template:*` channels), preload bridge, renderer types,
and a PLATFORM center-stage tab. No automated gate could be
executed in the authoring session (sandbox setup failure — shell
unavailable), so every row below stays Partial until the owner
machine or CI runs: focused suites, `npm test`,
`npm run check:syntax`, `npm run check:test-manifest`, `npx tsc
-b`, `npm run build`, `npm run check:release`, plus SMOKE steps
30–36. GUI smoke remains manual. Two defects found by inspection
during wiring were fixed without running: a double-registered
`workflow:get` channel (run status is `workflow:get-run`) and a
dropped audit `outcome` in the platform IPC helper.

Gate evidence 4A (2026-10-30, verification session): all
automated gates green on the owner Windows machine (same
evidence as 3C: full suite owner-confirmed green, focused
provider-config 5/5, router 7/7, runtime 8/8, github-adapter
4/4, ipc.integration 44/44). Four defects found during the
owner runs and fixed in-tree: (1) `provider-config.cjs`
required `../../../security|utils/*` — corrected to `../../`;
(2) it also required `./provider-registry.cjs` — corrected to
`./providers/provider-registry.cjs`; (3) `runtime.cjs`
`executeCommand` returned null-prototype vm-realm results to
host callers — new `plainForHost()` normalizes them (also
aligns the in-process path with the isolated worker path);
(4) negative-git tests in `github.adapter.test.cjs` and
`ipc.integration.test.cjs` assumed temp dirs sit outside any
repo, but the owner machine has a stray parent repo above
`%TEMP%` — both tests now set `GIT_CEILING_DIRECTORIES` like
`git.service.test.cjs` does (product behavior was correct;
no assertion was weakened). Rows stay Partial until SMOKE
steps 30–36 are manually confirmed, per the 3B.7 precedent.

| # | Item | Status | Direction |
|---|---|---|---|
| 4A.1 | Stable AI provider platform: descriptor contract, deterministic registry (duplicate protection), honest model catalog (unknown stays unknown), centralized routing with explicit-only fallback, selection-only config with env-allowlist secrets | Partial | `electron/services/ai/providers/provider-registry|model-catalog.cjs`, `provider-config.cjs`, `router.cjs` + tests; `meta-muse.provider.cjs` keeps first-class Meta path; 7 `provider:*` channels; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |
| 4A.2 | Secure extension system: strict manifest schema, install registry (disabled-by-default), vm-sandboxed runtime (no Node globals, JSON membrane, timeouts), 10-step lifecycle with startup recovery, declared command contributions | Partial | `electron/services/extensions/manifest|registry|runtime|lifecycle.cjs` + tests; 10 `extension:*` channels; local folders only, no marketplace; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |
| 4A.3 | Skills + workflow engine: validated skill definitions (tool catalog with permission mapping, gated tools need approval), versioned workflow definitions, explicit advance/approve/resume/cancel engine with bounded retries and persisted runs | Partial | `electron/services/skills/`, `electron/services/workflows/` + 4 builtin skills + 5 builtin workflows + tests; 6 `skill:*` + 11 `workflow:*` channels; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |
| 4A.4 | Integrations platform: shared adapter contract (auth kinds, capabilities, error normalization), local-git GitHub adapter (repos/branches/remotes/history — PRs/issues explicitly unsupported) | Partial | `electron/services/integrations/registry.cjs`, `github.adapter.cjs` + tests; 6 `integration:*` channels; no tokens in renderer/logs; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |
| 4A.5 | Project templates: validated manifests, preview-before-confirm generation, traversal rejection, atomic staging for new dirs, setup commands as instructions only | Partial | `electron/services/templates/template-engine.cjs` + 3 tested templates (basic-web, node-typescript, react-vite) + tests; 5 `template:*` channels; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |
| 4A.6 | Developer API + SDK: versioned api-contract service with compatibility checks, TypeScript SDK (`sdk/kryom.d.ts`), working hello-command example extension | Partial | `electron/services/platform/api-contract.cjs` + test; `examples/hello-command/`; `sdk/`; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |
| 4A.7 | Permissions + trust platform: 12 granular permissions (no wildcard), explicit grants with trust levels that never auto-grant, execution-boundary enforcement, secret-free audit log | Partial | `electron/services/permissions/`, `electron/services/audit/` + tests; 5 `permission:*` + `audit:list` channels; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |
| 4A.8 | Minimal platform UI: PLATFORM stage tab with Providers, Extensions, Skills, Workflows, Integrations, Templates, Perms views reusing the existing design system — no redesign, no fake listings | Partial | `src/components/PlatformHub.tsx`; `src/electron.d.ts` platform contracts; suite green 2026-10-30 (owner run), SMOKE 30–36 manual pending |

Acceptance: Meta AI still works through the new registry;
providers/skills/workflows/extensions install, validate, and run
through permissioned contracts; templates generate valid projects
without touching existing files unconfirmed; audit shows who did
what; full gate green.

### 4B — Global product and open-source readiness

Scope note (2026-10-30): this section was redefined by the
Level 4B task into fourteen areas (4B.1–4B.14) below,
replacing the earlier six-row sketch. Mapping: old 4B.1
(cross-platform) is covered by new 4B.2 (compat code for
all three OSs, validated Windows-only) and 4B.3 (mac/linux
packaging configured, untested); old 4B.2 (onboarding) by
new 4B.5; old 4B.3 (a11y) and 4B.4 (i18n) by new 4B.7
(architecture + new-UI strings + focus trap + motion;
English-only, old dialogs unconverted by design — no
framework before need was kept: the i18n core is ~120
lines, no dependency); old 4B.5 (docs/privacy/community)
by new 4B.4/4B.5/4B.6 (the in-app privacy view idea was
implemented as Help → Export Diagnostics with preview
instead of a `.kryom` browser); old 4B.6 (permissioned
integrations) remains enforced and is now documented in
4B.4. Structure 3B → 3C → 4A → 4B is preserved; no levels
were added. The full UI/UX redesign stays a separate
future milestone and was not performed.

Gate record 4B (2026-10-30, implementation session): all
fourteen areas implemented in this tree with colocated
tests (69 test files), 7 new IPC channels
(`diagnostics:support-*`, `update:*`), preload bridge,
renderer types, Diagnostics dialog, Updates tab, Settings
locale row, and the full docs/GitHub/CI set. No automated
gate could be executed in the authoring session (sandbox
setup failure — shell unavailable), so nothing below is
Verified; owner machine or CI must run: `npm test`,
`npm run check:syntax`, `npm run check:test-manifest`,
`npx tsc -b`, `npm run build`, `npm run pack` +
`npm run check:release`, plus SMOKE steps 37–42. GUI
smoke remains manual. Level 3C/4A statuses are untouched
by this milestone.

Gate evidence (2026-10-30, owner machine): `npm run pack`
succeeded (electron-builder 26.18.0, Electron 45, win x64;
rename retries with EPERM fell back to copy+delete — close
running instances before packing) and `npm run check:release`
passed — "Release contents ok: release\win-unpacked", 3973
asar entries, including the unpacked extension worker and the
new staleness guard.

Gate evidence 4B (2026-10-30, verification session): `npm
test` full suite green on the owner Windows machine
(owner-confirmed; exact totals unrecorded, 4 pre-existing
symlink-EPERM environment skips), `check:syntax` 170/170 ok,
`npx tsc -b` silent (clean), `npm run build` green via pack
(1332 modules), `check:test-manifest` green
(owner-confirmed), `npm run dist` installer build succeeded
(owner-confirmed; artifact name unrecorded). CI extended to a
windows/macos/ubuntu matrix (verify + pack jobs) in
`.github/workflows/ci.yml` — prepared but unexecuted (no
push/PR from this session). SMOKE 37–43 and the manual
desktop pass remain unrun; signing certs, app icons, and
feed hosting stay externally blocked.

| # | Item | Status | Direction |
|---|---|---|---|
| 4B.1 | Production release engineering: env separation (dev/preview/production + baked channel), packaged dotenv skip, log levels, fatal startup dialog, crash-handler error ring, DevTools + permission policies, startup timing | Implemented — Verification Pending | `services/release/environment.cjs`, `main.cjs` hardening, `utils/logger.cjs` levels + tests; suite green 2026-10-30 (owner run), SMOKE 42–43 manual pending |
| 4B.2 | Windows/macOS/Linux compatibility: OS adapter, shell-free executable lookup, POSIX detached spawn + process-group tree kill, Windows taskkill unchanged | Partial | Code complete for all three (`utils/platform.cjs`, `process-manager.cjs` + tests); validated Windows-only; validated Windows-only; 3-OS CI matrix prepared but unexecuted, mac/linux runtime pending runner results |
| 4B.3 | Installer/updater/rollback: mac(dmg)/linux(AppImage,deb) targets, asarUnpack worker, strict feed schema, sha512 staging, user-driven install, rollback-by-default, Updates tab | Partial | Architecture + config + UI complete; `pack` + `check:release` verified on owner machine; blocked externals: signing certs, app icons, feed hosting — all documented in `docs/RELEASING.md`, nothing faked; `dist` installer owner-green 2026-10-30 (artifact unrecorded) |
| 4B.4 | Security/privacy/compliance: permission + DevTools hardening, isolated extension hosts, preserved permissions/audit, `SECURITY.md`, `PRIVACY.md`, threat model + security architecture docs | Partial | Controls implemented + documented; hostile-code sandbox explicitly out of scope; security contact email pending owner |
| 4B.5 | Documentation + onboarding: INSTALLATION, DEVELOPMENT_SETUP, BUILDING, RELEASING, TROUBLESHOOTING, PLATFORM_SUPPORT, PRIVACY, FAQ, README accuracy | Implemented — Verification Pending | All docs written against inspected implementation; owner gates now green (see evidence); final accuracy pass rides the manual smoke run |
| 4B.6 | Open-source ecosystem: CONTRIBUTING, Code of Conduct, issue/PR templates, release workflow, extended CI | Implemented — Verification Pending | Files complete; repo settings (Advisories, branch rules) need owner clicks; `release.yml` unexecuted; CI matrix now 3-OS (unexecuted) |
| 4B.7 | i18n + a11y: typed English string table, locale detection + stored preference, Settings row, focus-trap hook on new dialogs, reduced-motion scroll | Partial | Architecture complete, new UI converted, English-only by choice; old dialogs unconverted by design (redesign milestone owns them) |
| 4B.8 | Performance + reliability: startup timing log, interval/listener audit (clean), reduced-motion fix, no behavior changes | Partial | No measured benchmarks exist — none are claimed; profiler-driven numbers need an owner run |
| 4B.9 | CI/CD: explicit tsc + secret-scan steps, manual-dispatch release workflow (build + validate + upload candidate, no publish) | Partial | Config complete and pinned; 3-OS matrix prepared, first runs pending a push/PR; release workflow unexecuted |
| 4B.10 | Versioning + supply chain: semver policy, changelog process, installed-tree license inventory (all permissive), audit + update guidance | Implemented — Verification Pending | `docs/DEPENDENCIES.md` + `docs/RELEASING.md`; no upgrades applied blindly |
| 4B.11 | Diagnostics + supportability: redacted bundle (booleans/counts/`~` paths), error ring, preview-before-export, local file, no upload | Implemented — Verification Pending | `support-bundle.cjs` + 2 channels + dialog + menu + tests; suite green 2026-10-30 (owner run), SMOKE 37 manual pending |
| 4B.12 | Integration + backward compat: no public contract breaks, no migrations required, 3B/3C/4A behavior preserved | Implemented — Verification Pending | Additive-only changes; existing suites owner-green 2026-10-30 pin the contracts |
| 4B.13 | Testing + acceptance: 7 new suites, wiring pins, manifest entries, 7 new channel flows, SMOKE 37–42 | Partial | `pack` + `check:release` verified on owner machine (3973 asar entries); `npm test`, `check:syntax`, `check:test-manifest`, `tsc -b`, standalone `build`, and SMOKE 37–42 automated gates owner-green 2026-10-30 (see evidence); SMOKE 37–43 + CI matrix runs still need owner/CI |
| 4B.14 | Documentation + roadmap accuracy: this record, changelog, testing/structure/architecture updates | Implemented | this verification record updates 3C/4A/4B rows from owner-run evidence; no flips to Verified (smoke + CI pending) |

Acceptance: owner/CI gates green; packaged app installs and
launches per the smoke list; mac/linux rows honestly marked;
no criterion Verified without evidence.

## Appendix A — `.kryom` committed-state assessment (2026-10-29, resolved 2026-10-30)

Inspected, not modified: `.kryom/chat.json` (empty history) and one
research session (`rs-mvsi843p-9gy8ii`, public Llama-docs research).
No secrets or key material found (searched for key/token patterns).
Risk was content privacy, not credential leak: chat history and
research objectives accumulate user-confidential text, and committing
`.kryom/` contradicts the README ("Never commit `.kryom/`"),
`chat-store.cjs` ("must never be shared or committed"), `.gitignore`,
and SMOKE step 17.

Resolution: the owner untracked everything in `f0d4f1d` ("chore:
stop tracking private .kryom state"), which also added the
`.gitignore` rule. Verified 2026-10-30: `git ls-files .kryom` is
empty at HEAD and on `origin/main`; the removed blobs hold research
prose only (re-audited, no credentials). The old blobs remain in
history; purging them needs a history rewrite, which requires
explicit owner approval and is NOT recommended for this benign
content. Level 3A.2 added `electron/security/git-privacy.test.cjs`,
which fails the suite if `.kryom/` files become tracked or the
ignore rule is lost. Standing rule: never force-add `.kryom/`.

## Appendix B — Carried-forward environment note

`docs/backend-limitations.md` records that `C:\Users\LENOVO` itself
is a Git repository, so ancestor discovery reports Git membership
everywhere. Verify dotfiles-intent vs stray init; until then, Git
panel results outside real repos are suspect.

## Appendix C — Dependency order

```text
2A.0 docs ─┬─► 2A.1 security ─┬─► 2A.2 release ─► 2B recovery ─┬─► 3A memory/plans ─► 3B verify/repair ─► 3C agents ─► 4A platform ─► 4B adoption (+ deferred OSS hygiene)
           │                  │                                 │
           └─► 2A.2.1/2A.2.2 CI gates run from 2A onward ◄──────┘
```
