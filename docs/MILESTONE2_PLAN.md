# Milestone 2 — Implementation Plan (from repo audit)

## What exists (reuse, don't duplicate)

- `electron/services/research/`: 7-step orchestrator (`research.service.cjs`) with
  background runs, cancel/resume, poll status; provider abstraction
  (`search-providers.cjs`: arXiv, OpenAlex, DuckDuckGo keyless + Tavily gated);
  workspace persistence (`session-store.cjs`: `.kryom/research/*.json`,
  `brief-*.md`, `active.json`); fail-closed brief validation + extractive
  fallback (`brief.service.cjs`); SSRF-safe DNS-pinned fetch
  (`url-fetch.service.cjs`).
- AI: provider registry + `meta-muse.provider.cjs` (`muse-spark-1.3` default,
  `muse-wonder-1.0`; single-shot text only, no native search) + allowlist
  (`ai-config.service.cjs`) + `MockProvider` for tests.
- Consumers already wired: research specialist (`researchSessionId`),
  Discovery chat attach (`chatResearchId`), agent-tab implement handoff,
  DOCX brief export. Approval gates + secrets stay untouched.
- Gates: `test` script enumerates every `*.test.cjs` (manifest gate);
  `ipc.integration.test.cjs` asserts the exact IPC channel set;
  `research.service.test.cjs` pins 7 steps, `deriveQuestions`/`deriveQueries`
  bounds, `compareEvidence` shape, extractive wording.

## Build (new modules in `electron/services/research/`)

1. `depth-profiles.cjs` — quick/standard/deep execution profiles (pure).
2. `planner.cjs` — LLM question decomposition w/ strict JSON parse +
   deterministic extractive fallback (pure, no hardcoded topics).
3. `search-providers.cjs` — add keyless Crossref + Semantic Scholar adapters
   (documented public APIs), provider `kind` (paper/web), stable source ids.
4. `credibility.cjs` — transparent quality signals from metadata only (pure).
5. `evidence.cjs` — extractive claim mapping, lexical corroboration,
   contradiction cues, honest statuses (pure).
6. `research.service.cjs` — extend in place: depth-aware runs, bounded
   concurrent sub-question search w/ per-question status, quality + evidence +
   verification folded into the existing 7 steps, stable ids, provenance.
7. `session-store.cjs` — v2 schema (migrates v1): depth, name, plan, claims,
   conflicts; rename/delete/search sessions.
8. `brief.service.cjs` — report sections (methodology, verification,
   conflicts, limitations), HTML export (escaped, dependency-free),
   research-to-chat/agent handoff builders (untrusted-data framing).
9. IPC `research.*`: extend `start`; add `rename`, `delete`, `search`,
   `export`, `handoff` (trusted-sender + validation; update integration
   test allowlist). Preload + `src/electron.d.ts` follow.
10. UI: evolve `ResearchPanel` into a tabbed Research Workspace
    (Overview/Plan/Sources/Evidence/Findings/Report) + source explorer w/
    filters + interactive citations (extend `MarkdownLite` w/ `onCitation`) +
    activity feed + export menu + session rename/delete/search.
11. Tests: `depth-profiles`, `planner`, `evidence`, `credibility`,
    `deep-research` backend suites (injected doubles only) + renderer suite;
    register every file in the `test` script.

## Non-goals / honest limits

- No PDF parsing dependency, no embeddings/reranker, no PDF export
  (Markdown/HTML/DOCX only), no streaming IPC (poll stays), no invented
  scores or peer-review claims, no auto-execute from research.
- Shell is unavailable in this session (`windows_elevated setup_required`);
  verification gates that need execution will be marked BLOCKED unless the
  shell recovers.
