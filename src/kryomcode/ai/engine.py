"""Task-oriented AI context preparation for KryomCode."""

from dataclasses import dataclass
from pathlib import Path

from kryomcode.ai.context import (
    DEFAULT_MAX_FILE_BYTES,
    DEFAULT_MAX_FILES,
    DEFAULT_MAX_TOTAL_BYTES,
    ContextDocument,
    collect_project_context,
)
from kryomcode.ai.selection import (
    DEFAULT_MAX_FILES as DEFAULT_CONTEXT_MAX_FILES,
)
from kryomcode.ai.selection import (
    DEFAULT_MAX_TOTAL_BYTES as DEFAULT_CONTEXT_MAX_BYTES,
)
from kryomcode.ai.selection import (
    select_relevant_context,
)


@dataclass(frozen=True)
class ContextPackage:
    """Structured, bounded project context prepared for an AI task."""

    task: str
    documents: tuple[ContextDocument, ...]

    @property
    def total_bytes(self) -> int:
        """Return the total source bytes represented by this package."""
        return sum(document.size_bytes for document in self.documents)

    def format_context(self) -> str:
        """Format selected files as clearly separated context sections."""
        sections = []

        for document in self.documents:
            sections.append(
                f"--- BEGIN FILE: {document.path} ---\n"
                f"{document.content}\n"
                f"--- END FILE: {document.path} ---"
            )

        return "\n\n".join(sections)


def prepare_context(
    project_root: str | Path,
    task: str,
    *,
    max_source_files: int = DEFAULT_MAX_FILES,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    max_source_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
    max_context_files: int = DEFAULT_CONTEXT_MAX_FILES,
    max_context_bytes: int = DEFAULT_CONTEXT_MAX_BYTES,
    include_hidden: bool = False,
) -> ContextPackage:
    """Collect project files and select those relevant to a coding task.

    This function performs local file processing only. It does not invoke
    an AI model, access the network, or modify project files.
    """
    if not isinstance(task, str) or not task.strip():
        raise ValueError("task must be a non-empty string")

    documents = collect_project_context(
        project_root,
        max_files=max_source_files,
        max_file_bytes=max_file_bytes,
        max_total_bytes=max_source_bytes,
        include_hidden=include_hidden,
    )

    selected = select_relevant_context(
        documents,
        task,
        max_files=max_context_files,
        max_total_bytes=max_context_bytes,
    )

    return ContextPackage(
        task=task.strip(),
        documents=tuple(selected),
    )