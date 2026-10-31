# Milestone 2 — Final Audit Report

Deep Research Engine + Professional Research Workspace.

Status: implemented and verified. No commit or push performed (awaiting review).

## 1. Initial architecture and features discovered

- `electron/services/research/`: 7-step orchestrator (`research.service.cjs`)
  with background runs, cancel/resume, poll status; provider abstraction
  (`search-providers.cjs`: arXiv, OpenAlex, DuckDuckGo keyless + Tavily
  gated); workspace persistence (`session-store.cjs`); fail-closed brief
  validation + extractive fallback (`brief.service.cjs`); SSRF-safe
  DNS-pinned fetch (`url-fetch.service.cjs`).
- AI: provider registry + `meta-muse.provider.cjs` (`muse-spark-1.3`
  default, `muse-wonder-1.0`; single-shot text only, no native search) +
  model allowlist (`ai-config.service.cjs`) + `MockProvider`.
- Consumers already wired: research specialist (`researchSessionId`),
  Discovery chat attach (`chatResearchId`), agent-tab implement handoff,
  DOCX brief export. IPC trust boundaries + input validation throughout.
- Gates: enumerated `test` script + manifest gate, exact IPC channel
  allowlist in `ipc.integration.test.cjs`, pinned research behavior in
  `research.service.test.cjs`, workbench-state pure-TS gate.

## 2. Existing research capabilities reused

Provider abstraction + normalize/dedup/canonicalKey, SSRF-safe fetch,
session persistence + atomic storage layer, `validateBrief` fail-closed
gate, extractive brief fallback, Meta provider + model allowlist,
specialist/chat/agent handoff points, DOCX export, trusted-sender IPC
pattern, `ResearchPanel` props contract + polling + `MarkdownLite`.

## 3. Problems identified

- Template-only planning (`deriveQuestions`/`deriveQueries`), fixed
  limits, sequential search, no per-subtask status.
- No claim extraction/verification/conflict detection; index-based
  citations; no quality signals beyond access/type.
- Only 2 academic providers; keyword queries too noisy (generic filler
  words leaked into queries — fixed, see 8).
- Simple panel UI: no workspace, tabs, filters, interactive citations,
  rename/delete/search, Markdown/HTML export.
- Semantic Scholar 429s under concurrent load (paced now; see 22).

## 4. New research architecture

```
Renderer Workspace (ResearchPanel tabs)
→ Typed preload API → Trusted IPC (research.*)
→ research.service.cjs (depth-aware orchestrator)
→ planner.cjs → search-providers.cjs (6 adapters)
→ url-fetch.service.cjs → credibility.cjs + evidence.cjs
→ Meta synthesis (validated) → session-store.cjs v2
→ brief.service.cjs reports + handoffs
```

New pure modules: `depth-profiles.cjs`, `planner.cjs`, `evidence.cjs`,
`credibility.cjs`. Orchestrator extended in place (same 7 steps).

## 5. Search providers implemented

arXiv, OpenAlex, DuckDuckGo, Tavily (key-gated) retained; **Crossref**
(`api.crossref.org/works`, anonymous pool) and **Semantic Scholar**
(`graph/v1/paper/search`, paced 1.1s) added. Provider `kind`
(paper/web) drives round routing. All failures recorded per-provider;
runs continue and complete honestly.

## 6. Academic providers implemented

arXiv, OpenAlex, Crossref, Semantic Scholar — all keyless, all through
the existing provider contract with injected-`fetchImpl` tests.

## 7. Actual Meta model integration

`muse-spark-1.3` (default) / `muse-wonder-1.0` via `MetaMuseProvider`
for planning decomposition and brief synthesis only. Model selectable
per run (validated against `SUPPORTED_MODELS` at IPC and service
layers). No key → extractive planning + brief, recorded in `via`.
Muse models never perform search; discovery and reasoning stay
separate. Single-shot text; no streaming/vision/tools claimed.

## 8. Research planning and orchestration behavior

- `planResearch`: LLM JSON decomposition (strict-parse, bounds
  enforced) with deterministic keyword fallback; ambiguity notes.
- Stopword-aligned keyword extraction; every question leads with the
  raw objective; per-round query dedup.
- Bounded concurrent sub-question search (2/3/4 by depth), per-question
  status persisted, chunk-boundary writes (no write races), partial
  failures recorded, cancellation aborts promptly, deep adds a
  terminology-refinement pass. Caps: sources 8/20/40, reads 3/6/12.

## 9. Evidence and citation verification behavior

Extractive pipeline (all methods labeled in output): sentence claims
(`clm-n`) mapped to stable source ids; lexical corroboration across
independent sources only (different provider or host);
`supported` / `partially-supported` / `insufficient-evidence` /
`conflicting-evidence` / `unverified` statuses with explanations;
conservative conflict flags (high overlap + opposing cues).
`validateBrief` still gates every report; live E2E briefs validated
`ok:true`.

## 10. Source credibility methodology

`assessSource`: observations from returned metadata only (authorship,
venue, DOI, date/recency, open access, preprint caveat, domain). No
numeric scores; peer review never claimed without evidence; quality
kept separate from verification status. Display-only `rankSources`.

## 11. Research session persistence

Schema v2 (migrates v1: defaults + id backfill): depth, name, plan,
claims, conflicts, source ids/supports/retrievedAt/quality. Same
`.kryom/research/` storage. Added rename/delete (link-safe, active
repointed)/search. Restart recovery preserved (interrupted → blocked →
resume).

## 12. Report generation and export

Methodology, verification, conflicts sections added (extractive + LLM
prompt). Export: Markdown, self-contained HTML (escaped, no scripts),
DOCX (existing). No PDF (no PDF lib; adding one was unjustified).
Exports render saved state; citations resolve to stored sources.

## 13. Research-to-code integration

`research:handoff` (`chat` | `agent-brief`, optional finding subset)
returns UNTRUSTED-framed text; UI copy buttons + existing Ask/Implement
wiring preserved. Findings stay reference material; no auto-execute;
all agent approval gates untouched.

## 14. UI/UX implementation

`ResearchPanel` evolved (same props) into a tabbed workspace:
Overview (steps, sub-questions, queries, errors), Plan, Sources
(filters + inspect drawer + quality + supports + linked findings),
Evidence (claims/conflicts), Findings (handoff copy), Report
(citation-linked brief + md/html/docx export). Depth + model
selectors, example prompts, session search/rename/delete-with-confirm,
auto-surface finished report without stealing views. Styling reuses
theme tokens + existing compact classes; ~60 lines of new CSS.

## 15. Accessibility and responsive behavior

Labeled controls, tablist semantics, citation `aria-label`s, focus
rings from the design system, wrapping tab strip, bounded lists.
Light/dark via theme tokens. Narrow-window and keyboard flows follow
existing app patterns; interactive GUI walkthrough not performed
(see 21).

## 16. Security review

- Network stays in main process; no credentials to renderer.
- All IPC inputs validated; trusted-sender checks kept.
- New URL surfaces reuse `assertSafeUrl`/DNS-pinned fetch; HTML export
  escapes everything, links http(s)-only, no scripts.
- Retrieved content treated untrusted end-to-end (ingestion stripping,
  citation-lookalike sanitizing, handoff framing).
- Session-id allowlist, storage-layer symlink rejection, link-safe
  delete, bounded sizes/timeouts/concurrency, secrets redaction
  unchanged, approval gates intact. No new dependencies.

## 17. Files changed and added

Changed: `research.service.cjs`, `search-providers.cjs`,
`session-store.cjs`, `brief.service.cjs`, `research.ipc.cjs`,
`preload.cjs`, `ResearchPanel.tsx`, `MarkdownLite.tsx`, `app.css`,
`electron.d.ts`, `package.json`, `ipc.integration.test.cjs`,
`wiring.test.cjs`, `search-providers.test.cjs`,
`MarkdownLite.test.tsx`, `ARCHITECTURE.md`, `PROJECT_STRUCTURE.md`.
Added: `depth-profiles.cjs`, `planner.cjs`, `evidence.cjs`,
`credibility.cjs` + 5 backend test files + `ResearchPanel.test.tsx` +
`MILESTONE2_PLAN.md` + this report.

## 18. Tests added

Backend: `depth-profiles`, `planner`, `evidence`, `credibility`,
`deep-research` suites; Crossref/S2/id/kind/pacing provider tests;
IPC lifecycle test (rename/search/export/handoff/delete + rejections);
wiring rows. Renderer: `ResearchPanel.test.tsx` (10 tests),
`MarkdownLite` citation test. All external boundaries use injected
doubles. No existing test weakened (only allowlist/list extensions
for new channels/exports).

## 19. Exact results of every verification command

All executed 2026-10-31 after final edits (escalated shell; default
sandbox was broken session-wide with `windows_elevated
setup_required`, which also failed 3/4 workflow audit agents):

- `npx tsc -b` → exit 0, no errors.
- `npm test` → exit 0: 698 tests, 693 pass, 0 fail, 5 skipped
  (pre-existing environment skips), 80 suites.
- `npm run test:renderer` → exit 0: 10 files, 87 tests, all pass.
- `npm run check:syntax` → 184 backend files, 184 ok, 0 failed.
- `npm run check:test-manifest` → 76 on disk, 76 listed.
- `npm run check:workbench` → ok.
- `npm run build` → exit 0 (pre-existing chunk-size warning only).
- `npm run pack` → exit 0 (`release/win-unpacked/KryomCode.exe`).
- `npm run check:release` → 3987 asar entries, ok.

## 20. Real end-to-end testing evidence

Live runs (repo-root `node` probes, temp workspaces, keyless
providers, `allowLlm:false` — no mocks):

- Quick run, representative question on reliable autonomous coding
  agents: `completed`, 8/8 sources (arXiv 3, OpenAlex 3, Crossref 2),
  all steps done, brief `validateBrief ok:true`, session reopened from
  disk, handoff + HTML export generated.
- Standard run, same question: `completed`, 20/20 sources
  (arXiv 5, OpenAlex 10, Crossref 5), 39 claims with mixed statuses,
  44 findings, brief at 24k cap valid, reopen + exports verified.
- Manual citation check: `http://arxiv.org/abs/2601.04327v1`
  retrieved from the live arXiv page — title, authors, and abstract
  match the stored source record exactly.
- LLM synthesis/planning NOT live-tested (no `MODEL_API_KEY` in this
  environment) — covered by injected-provider tests instead. Tavily
  NOT live-tested (no key) — correctly absent from provider list.

## 21. Manual GUI verification status

NOT performed: no interactive desktop session was available, and the
built app is Electron (not browser-testable). Renderer behavior is
covered by 87 automated tests including 10 workspace tests; reviewers
should click through: start (each depth) → tabs → filters →
citation jump → export → rename/delete → Ask/Implement.

## 22. Known limitations and blocked integrations

- Semantic Scholar: HTTP 429 under shared-IP load despite 1.1s
  pacing; recorded as provider errors, runs complete. A key or
  lower fan-out would help; no key management was added.
- DuckDuckGo instant API often returns zero results for complex
  queries (no error, just empty); Tavily key would strengthen web
  coverage.
- No PDF parsing, embeddings/reranker, streaming IPC, or PDF export
  (deliberate: no heavy deps).
- Quick mode skips claim verification by design.
- LLM paths need `MODEL_API_KEY` for live use.

## 23. Recommended next steps

1. Review + merge; run one reviewer GUI pass (see 21).
2. Optional Tavily key for stronger web search; optional S2 key.
3. Consider full-text PDF extraction (dependency review first).
4. Consider streaming progress IPC if polling proves coarse.
5. Deep-mode live soak run + timing telemetry.

Definition of done: met except interactive GUI walkthrough (21),
which needs a reviewer session. Awaiting review and approval — nothing
committed or pushed.
