# Milestone 2 — Final Acceptance Audit Report

Date: 2026-10-31. Method: live provider runs, behavior probes with
injected doubles, citation re-verification, full gate suites, plus
developer-reported manual GUI verification of the packaged app.
No code changed during the audit.

## Verdict

**ACCEPTED.**

No Critical or High severity defect was found, every automatable
check passes, and the developer has now completed manual GUI
verification of the packaged Windows application with all nine
acceptance areas successful (see Manual GUI verification below).

## Test results by case

### 1. Depth modes (same question, live)

Question: "How can small AI models improve autonomous coding agents?"
No mocks, no LLM key (extractive path).

| Depth | Result | Questions | Queries | Sources | Claims | Findings | Brief | Time |
|---|---|---|---|---|---|---|---|---|
| Quick | PASS | 2 | 3 | 8/8 cap | 0 (skipped by design) | 8 | 12,555 chars, valid | 9.5s |
| Standard | PASS | 4 | 6 | 20/20 cap | 36 | 42 | 24,000 chars, valid | 12.5s |
| Deep | PASS | 6 | 8 | 40/40 cap | 78 | 95 | 24,000 chars, valid | 23.0s |

All runs `completed`, all 7 steps `done`/`skipped`, briefs
`validateBrief ok:true`. Depth changes real behavior: question count,
query fan-out, source caps, verification on/off, refinement pass.

### 2. Planning/search/evidence/report differences

PASS. Plans differ (2/4/6 sub-questions, topic
"reliable autonomous coding agents tool" after stopword fix);
query breadth differs (3/6/8 executed, deduped per round); source
breadth differs (8/20/40); evidence differs (0/36/78 claims);
report depth differs (12.5k vs capped 24k with verification sections).

### 3. Providers and failure handling

PASS. Live contributions: arXiv, OpenAlex, Crossref in every run
(e.g. deep: 6/17/17). DuckDuckGo returned zero results without
errors. Semantic Scholar returned HTTP 429 under shared-IP load;
every failure recorded on the session (`errors: 2/5/7` by depth)
and all runs completed. Tavily correctly absent without a key.
1.1s S2 pacing verified by dedicated test.

### 4. Deduplication and stable IDs

PASS. Unique canonical keys == source count in all runs (8/8, 20/20,
40/40). Recomputed IDs match stored IDs. Cross-run stability
confirmed: `src-4dfa6bf125e3` identifies the same arXiv URL in all
three runs. Case-insensitive query dedup verified in trace.

### 5. Citation accuracy (5 sources)

PASS (5/5). Titles/authors match the original records:

1. `arxiv.org/abs/2610.35077v1` — direct page title matches exactly.
2. `doi.org/10.1007/s11704-024-40231-1` — Crossref metadata title
   matches (publisher page bot-blocked).
3. `aclanthology.org/2026.acl-long.745` — direct page title/authors
   match.
4. `doi.org/10.2139/ssrn.5405948` — Crossref metadata title matches
   (SSRN 403 to bots).
5. `doi.org/10.1007/979-8-8688-2454-8_7` — Crossref metadata title
   matches (publisher page bot-blocked).

### 6. Claim-to-evidence mapping and statuses

PASS (live) / PASS (synthetic conflict). Standard run: 36 claims
(27 insufficient-evidence, 7 partially-supported, 2 supported);
deep: 78 (47/19/12). Every claim carries sourceId + supporting IDs
resolving to stored sources. Conflicting-evidence verified via
opposing-abstract probe (1 conflict, claims marked). No live run
produced a conflict (data-dependent; messaging states absence of
flags is not agreement). `unverified` is a display fallback, never
assigned — see Low defect L1.

### 7. Credibility honesty

PASS. Preprint without authors/date yields cautions ("No author
identified", "Publication date unknown", "Preprint — peer review
not verified") and no positive peer-review signal. No numeric
scores exist on the assessment surface (`{signals, summary}` only).

### 8. Progress, cancellation, partials, recovery

PASS (4/4 probes). Mid-run cancel → `cancelled`, run rejects
/cancelled/. Interrupted run (running, no controller) → `blocked`
on status read. Resume → `completed` with sources. Deep refinement
pass fires on sparse results (trace shows refinement query
"objective + discovered term").

### 9. Injection defenses and handoff

PASS. Malicious source (`[99]`, `<script>`, `<img onerror>`,
"ignore all previous instructions") produces a valid brief with no
leaked markup/citations; handoff carries UNTRUSTED framing and
"not instructions" wording for both targets.

### 10. Exports

PASS. Markdown equals saved brief (3,395 chars in probe). HTML is
self-contained, escaped, unsafe schemes never linked. DOCX:
`brief-<id>.docx`, ~11 KB via existing document service.

### 11. Workspace tabs and responsive layout

PASS — automated plus developer-reported manual. All six tabs render
and navigate in jsdom tests (10/10 ResearchPanel tests, incl.
filters, citation jump, rename, confirmed delete, export, handoff
copy, error box). CSS uses theme tokens + wrapping tab strip. The
developer additionally verified all tabs, filters, citation/evidence
navigation, and narrow-window responsiveness interactively in the
packaged app (see Manual GUI verification).

### 12. Milestone 1 Advanced AI Chat regression

PASS. Plain chat answers via provider; research attach grounds with
untrusted-labeled context; agent `planTask` accepts
`researchSessionId`. Full suites green: backend 698 tests / 0 fail,
renderer 87/87 (incl. AiChat 19, ChatSessions 13, WelcomePage
research routing with the real panel).

## Defects

No Critical or High defects.

- **L1 (Low): `unverified` status is display-only.**
  File: `electron/services/research/evidence.cjs`
  (`corroborateClaims`), consumed in `brief.service.cjs` and
  `ResearchPanel.tsx`. Cause: every extracted claim is assigned one
  of four statuses; unread/short-text sources yield findings, not
  claims, so the `|| 'unverified'` fallback never triggers. The
  five-status taxonomy is effectively four assigned + fallback.
  Recommended fix: document the four assigned statuses as the
  taxonomy, or mint explicit `unverified` claims for short-text
  sources. Not acceptance-blocking: unread sources are already
  labeled "do not cite as evidence".
- **L2 (Low): no biomedical provider.** PubMed ("where relevant")
  was not added. Acceptable for a coding tool; add only on demand.
- **L3 (Low): no PDF export.** Allowed by the milestone
  ("if reliable mechanism available"); Markdown/HTML/DOCX cover
  the requirement.

## Provider/API limitations

- Semantic Scholar 429s persist under shared-IP load despite pacing;
  runs complete on other providers. A key would remove the cap.
- DuckDuckGo instant API returns empty for complex queries; web
  coverage without a Tavily key is thin.
- LLM planning/synthesis untested live (no `MODEL_API_KEY`);
  covered by injected-provider tests.

## Performance and reliability

Quick ~10s, Standard ~13s, Deep ~23s (network-bound; timeouts cap
worst case). Caps respected exactly (8/20/40 sources; 24k brief).
Zero failed runs across 5 live sessions despite 14 provider errors.
Cancel responds promptly; resume is deterministic; IDs stable.

## Manual GUI verification — PASS (developer-reported)

The developer manually tested the packaged Windows application
`release/win-unpacked/KryomCode.exe` and reports all nine areas
successful:

1. Quick, Standard and Deep research — PASS.
2. All Research Workspace tabs — PASS.
3. Source filters, details and citation/evidence navigation — PASS.
4. Markdown, HTML and DOCX exports — PASS.
5. Session rename, delete and persistence — PASS.
6. Research-to-Chat and Research-to-Agent handoff — PASS.
7. Narrow-window responsiveness — PASS.
8. Active research cancellation — PASS.
9. Advanced AI Chat regression — PASS.

Evidence: developer's written test report (this task's acceptance
statement). No screenshots, recordings, or GUI logs were provided,
and none are claimed here.

## Final acceptance recommendation

**Accept Milestone 2.** All twelve audit cases pass, no
Critical/High defects remain, the three Low-severity limitations
(L1–L3) are documented and non-blocking, and manual GUI
verification is complete.
