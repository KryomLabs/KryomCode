# Project memory

Level 3A.1: user-curated project knowledge (decisions, conventions,
facts) with recorded provenance and source-change staleness.

## What is stored

Each memory record holds a type (`decision`, `convention`, or `fact`),
an optional title, free-text content, creation/update timestamps, and
up to 20 source references. Sources are fingerprinted by the main
process when the record is saved — the UI names a source but never
its fingerprint:

| Source | What is recorded |
|---|---|
| File | Workspace-relative path + SHA-256 of its bytes (files up to 1 MB) |
| Chat | SHA-256 of the project's `.kryom/chat.json` at save time |
| Research | Research session id + brief version number |
| Commit | Full 40-character SHA, verified present via `git cat-file -e` |

A record is **stale** when any source changed or vanished (edited
file, cleared chat, superseded brief, missing commit). A commit that
cannot be checked (Git not installed) is reported as **unverified**,
never as current. Only referenced files are read — listing memories
never walks or hashes the repository.

## Where it is stored

One JSON file per record: `<project>/.kryom/memory/<id>.json`.
Writes are atomic (temp-file + rename); an interrupted save leaves
the previous version intact. Records are per-project: opening another
project shows only its own memories.

## Inspect and delete

- In the app: the Memory activity-bar view lists records with type,
  stale status, and provenance; each record offers Edit and Delete
  (delete asks for confirmation). **Delete all** removes every
  memory in the current project after an explicit danger
  confirmation; chat history, checkpoints, and research data are
  kept. Partial failures are reported per record.
- On disk: read or delete the JSON files under `.kryom/memory/`
  directly. Unreadable files are reported by name in the app and
  never auto-deleted.

## Export format

**Export** (Memory view header) writes a portable JSON document to a
destination chosen in the native save dialog (any folder; the write
is atomic and `.json` is enforced). Cancelling the dialog is a
normal outcome. The document contains only validated records:

```jsonc
{
  "version": 1,
  "kind": "kryom-memory-export",
  "exportedAt": "2026-10-30T00:00:00.000Z",
  "projectName": "my-project",
  "records": [
    {
      "id": "mem-...",
      "type": "decision",
      "title": "Use tabs",
      "content": "We use tabs.",
      "createdAt": "2026-10-30T00:00:00.000Z",
      "updatedAt": "2026-10-30T00:00:00.000Z",
      "sources": [
        { "kind": "file", "path": "src/app.ts", "digest": "<sha256>" }
      ]
    }
  ],
  "skipped": ["mem-rotten"]
}
```

`skipped` lists stored files that failed validation (left on disk,
excluded from the export). The export carries no absolute paths, no
freshness state (recomputed on demand), no API keys, no
credentials, no environment variables, and no unrelated project
files. Treat the exported file as project-confidential: it holds
the same knowledge as the memories themselves.

## Privacy

- `.kryom/` is in `.gitignore`, so memories do not enter Git commits
  unless someone force-adds them. A `git privacy` test fails the
  suite if `.kryom/` files become tracked or the ignore rule is
  lost.
- Memory content never leaves the machine except through an
  explicit **Export** to a user-chosen file: there is no agent
  integration yet, and viewing memories sends nothing anywhere.
- Do not store credentials, tokens, or customer data in memories:
  anyone with project access can read `.kryom/` like any project
  file.

## Git history note (KryomCode repository)

An earlier revision of this repository briefly tracked `.kryom/`
(chat history, one research session, its brief, and the active
pointer). The owner untracked all of it in `f0d4f1d` ("chore: stop
tracking private .kryom state"), which also added the `.gitignore`
rule; no `.kryom/` files are tracked at HEAD or on `origin/main`.
A 3A.2 audit of the removed blobs found research prose only — no
API keys, tokens, or credentials (matches for "token"/"API docs"
were paper abstracts about Llama 3). The old blobs remain in Git
history as ordinary unreachable-after-checkout history; rewriting
history to purge them is deliberately out of scope without explicit
owner approval, since the content is benign and a rewrite would
disturb every clone. Migration plan: none required — keep the
ignore rule (test-guarded), never force-add `.kryom/`, and keep
documenting the exception if it ever recurs.
