# KryomCode Skills and Workflows Guide

Skills are reusable capabilities. Workflows are ordered,
composable operations. They are different systems with one
shared rule: nothing bypasses approvals, freshness checks,
checkpoints, or cancellation.

## Skills

A skill binds instructions to tools from a fixed catalog.
The catalog is the whole surface — unlisted tools cannot be
invoked.

| Tool | What it runs | Permission | Needs approval |
|---|---|---|---|
| `intelligence.search` | project search | `workspace.metadata` | no |
| `intelligence.architecture` | architecture analysis | `workspace.metadata` | no |
| `intelligence.impact` | impact analysis | `workspace.metadata` | no |
| `planning.build` | implementation plan | `ai.tools` | no |
| `specialist.research/coding/testing/debugging/security/review` | that specialist | `ai.tools` | no |
| `agent.propose` | change proposal | `ai.tools` | no |
| `agent.apply` | apply edits | `workspace.write` | **yes** |
| `diagnostics.run` | run a check | `terminal.execute` | **yes** |

Definition shape (`skillVersion: 1`):

```json
{
  "skillVersion": 1,
  "id": "project-analyst",
  "name": "Project Analyst",
  "version": "1.0.0",
  "instructions": "Describe the project layout with evidence.",
  "tasks": ["Summarize the layout"],
  "tools": ["intelligence.architecture", "intelligence.search"],
  "entryTool": "intelligence.architecture",
  "permissions": ["workspace.metadata"]
}
```

Validation requires every tool's permission to be declared.
The runner (`skill-runner.cjs`) checks all grants for
subject `skill:<scope>:<id>` before running, and gated
tools additionally require the run's explicit `approved`
flag. Missing grants fail with `Permission denied` — grant
them in PLATFORM → Perms.

Scopes, highest precedence first: project (`.kryom/skills/`
in the open project) → user → extension → builtin. Only
user and project scopes are writable through the UI.

Builtin skills: `project-analyst` (keyless),
`code-reviewer`, `security-sentinel`, `test-advisor`.

## Workflows

A workflow is a versioned list of at most 20 steps
(`workflowVersion: 1`). Step kinds:

```
intelligence.search, intelligence.architecture,
intelligence.impact, planning.build, skill.run,
specialist.run, agent.propose, agent.apply,
diagnostics.run, quality.build, approval.checkpoint, report
```

- `skill.run` needs `uses` (a skill id).
- `specialist.run` needs `specialist` + `task`.
- `approval.checkpoint` needs `message`.
- Each step declares `retries` (0–3), `timeoutMs`, and
  `onFailure` (`stop` | `continue`).

The engine (`workflow-engine.cjs`) never runs
autonomously. Runs advance only through explicit
`start → advance* → approve → advance*` calls, plus
`resume` and `cancel`. Denying a checkpoint ends the run
as cancelled with a recorded reason. Retries are
bounded, outputs are size-capped, runs persist under the
project's `.kryom/` with retention caps, and failures
report the exact step that failed.

Builtin workflows: `project-analysis` (keyless),
`feature-implementation`, `bug-investigation`,
`test-verification`, `security-review`.

## Safety summary

- No workflow skips human approval; no destructive step
  runs silently.
- No unbounded loops or infinite retries.
- Interrupted runs resume explicitly and report honestly.
- No success is reported without evidence — see the run's
  per-step states and history.
