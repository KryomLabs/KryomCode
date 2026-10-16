"""Deterministic task-aware selection of project context documents."""

import re
from collections import Counter

from kryomcode.ai.context import ContextDocument

DEFAULT_MAX_FILES = 10
DEFAULT_MAX_TOTAL_BYTES = 200_000

STOP_WORDS = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for",
        "from", "how", "i", "in", "is", "it", "of", "on", "or",
        "our", "please", "that", "the", "this", "to", "we", "what",
        "when", "where", "with", "you", "your",
    }
)

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> list[str]:
    """Extract normalized, useful words from text."""
    return [
        token
        for token in _TOKEN_PATTERN.findall(text.lower())
        if token not in STOP_WORDS and len(token) > 1
    ]


def _score_document(document: ContextDocument, task_tokens: list[str]) -> int:
    """Score a document using task-term matches in its path and content."""
    path_tokens = Counter(_tokens(document.path))
    content_tokens = Counter(_tokens(document.content))

    score = 0

    for token in task_tokens:
        # File-path matches are stronger signals than content matches.
        score += min(path_tokens[token], 3) * 10
        score += min(content_tokens[token], 20)

    return score


def select_relevant_context(
    documents: list[ContextDocument],
    task: str,
    *,
    max_files: int = DEFAULT_MAX_FILES,
    max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
) -> list[ContextDocument]:
    """Return the highest-relevance documents within configured limits.

    Results are ordered by descending relevance, with relative path as a
    deterministic tie-breaker. Documents with no task-term matches are
    excluded. This function does not read files or call external services.
    """
    if not isinstance(task, str) or not task.strip():
        raise ValueError("task must be a non-empty string")
    if max_files < 1:
        raise ValueError("max_files must be at least 1")
    if max_total_bytes < 1:
        raise ValueError("max_total_bytes must be at least 1")

    task_tokens = _tokens(task)
    if not task_tokens:
        return []

    # Duplicate query words should not artificially inflate relevance.
    task_tokens = sorted(set(task_tokens))

    ranked = [
        (document, _score_document(document, task_tokens))
        for document in documents
    ]
    ranked = [
        (document, score)
        for document, score in ranked
        if score > 0
    ]
    ranked.sort(key=lambda item: (-item[1], item[0].path))

    selected: list[ContextDocument] = []
    total_bytes = 0

    for document, _score in ranked:
        if len(selected) >= max_files:
            break

        if document.size_bytes < 0:
            continue
        if total_bytes + document.size_bytes > max_total_bytes:
            continue

        selected.append(document)
        total_bytes += document.size_bytes

    return selected