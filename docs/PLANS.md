# Evidence-based execution plans

Level 3A.3: agent proposals become persistent, evidence-linked
execution plans. Nothing about the review-first workflow changes —
approval, confirms, and checkpoints all still gate execution — but
progress, risks, and verification results now survive restarts and
are shown honestly.

## Schema (v2)

Proposals predate persistence (v1 shape: model, task, edits,
commands, notes). Tracking normalizes any v1-shaped proposal into
a v2 record, so old drafts and old callers keep working; new
planner output additionally carries `expectedOutcome`, `risks[]`
(severity, explanation, mitigation), and `suggestedSteps[]`. The
store only ever writes v2.

A plan record holds: stable id, project name, title, objective,
expected outcome, risks, ordered steps, the original proposal,
status (`active`/`completed`/`cancelled`), timestamps, and a
derived verification state (`unverified`/`partial`/`verified`/
`failed`).

Step states: `pending`, `in_progress`, `completed`, `verified`,
`blocked`, `failed`, `cancelled`. Transitions are enforced
(e.g. `pending` cannot jump to `verified`); terminal plans are
locked.

## Evidence and verification guarantees

- A step becomes `verified` only with a **persisted passing
  verification report** attached. Claims alone are rejected by the
  store, as is marking a step verified from a failing check.
- Verification reports (3B.5) separate execution facts
  (observed-run registry entry: command, start/completion
  timestamps, duration, exit code, cancelled/timed-out flags,
  `diagnostics` source), observed evidence (bounded 4 KB
  secret-redacted output excerpt, persisted diagnosis, repair
  checkpoint id + changed files), display-only model
  explanations (bounded, redacted, never consulted for status),
  and unverified claims (stated reasons, legacy provenance).
  The conclusion (`passed/failed/cancelled/timed_out/blocked/
  skipped/not_executed`) derives from observed facts only, and
  the legacy `result` mirrors it for old readers; reports pin
  `liveProvider: false` and `origin: 'command'`, so no UI may
  claim live AI verification. Plan/step ids, repair cycle and
  attempt linkage, and the diagnosis/execution run ids are
  preserved and re-validated on every read.
- Failures are recorded on the step with their report; earlier
  completed work is untouched, and retry is an explicit
  transition — never silent.
- Steps carry evidence links (checkpoint, report, diagnostics,
  file, commit, note). Bounds: 50 reports per plan, 50 evidence
  items per step, 50 retained plans (terminal-only pruning; active
  work is never pruned).

## Recovery

Step liveness is process-local. A step stored as `in_progress`
that this process never started is reported `interrupted: true`
and stays that way until the user explicitly resumes, blocks,
retries, or cancels it. Interrupted steps are never silently
completed. Cancelling a plan marks every open step `cancelled`
with the reason; applied edits stay on disk (undo via
checkpoints).

## Storage

One directory per plan: `<project>/.kryom/plans/<id>/plan.json`
plus `reports/<reportId>.json`. Writes are atomic; records are
re-validated on every read (malformed plans list under `corrupt`,
never crash the list); ids are pattern-locked so no traversal or
cross-project access is possible. Like all `.kryom/` content, plans
are gitignored (see [MEMORY.md](MEMORY.md) and the roadmap
Appendix A).

## UI

The agent panel tracks each proposal on receipt, shows the
expected outcome and risks at review, and renders a progress
section: step states, evidence, interruption banners with
Resume/Mark-blocked, persisted verification reports, and explicit
Complete/Cancel-plan actions. Tracking failures are reported but
never block review, apply, or verification.

## Attached context (3A.4)

Planning records a provenance-labelled snapshot of exactly what
the model received: per-file digests (8 files max, existing
gatherer caps), the research session id + brief version, an
opt-in chat excerpt (4000 chars, redacted), and a workspace-brief
digest. The snapshot is validated and stored on the plan record
(legacy plans show null); reads re-check files and research
(current/stale/missing) while chat and workspace stay labelled as
point-in-time references. Sources are auto-attached as review
evidence (`file`/`research`/`chat` kinds) and can never satisfy
verification. Chat reaches the model only via the explicit
"Include recent chat" toggle, previewable beforehand through
`agent:chat-excerpt` without transmitting anything.
