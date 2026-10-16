"""Bounded, read-only project context collection for KryomCode."""

import os
from dataclasses import dataclass
from pathlib import Path

from kryomcode.core.project import resolve_project_root

DEFAULT_MAX_FILES = 100
DEFAULT_MAX_FILE_BYTES = 100_000
DEFAULT_MAX_TOTAL_BYTES = 500_000

IGNORED_DIRECTORIES = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "env",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        ".tox",
        ".idea",
        "dist",
        "build",
        "coverage",
    }
)

TEXT_EXTENSIONS = frozenset(
    {
        ".py", ".pyi", ".md", ".rst", ".txt",
        ".toml", ".ini", ".cfg", ".yaml", ".yml",
        ".json", ".xml", ".html", ".css",
        ".js", ".jsx", ".ts", ".tsx",
        ".sql", ".sh", ".ps1", ".bat",
        ".c", ".h", ".cc", ".cpp", ".hpp",
        ".cs", ".go", ".rs", ".java",
        ".kt", ".swift", ".rb", ".php",
        ".vue", ".svelte", ".dart",
    }
)

SENSITIVE_NAMES = frozenset(
    {
        ".npmrc",
        ".pypirc",
        "id_rsa",
        "id_ed25519",
        "credentials",
        "credentials.json",
        "secrets",
        "secrets.json",
    }
)


@dataclass(frozen=True)
class ContextDocument:
    """A text file collected from a project."""

    path: str
    content: str
    size_bytes: int


def _is_sensitive_file(path: Path) -> bool:
    """Return True for common secret and private-key filenames."""
    name = path.name.lower()

    if name in SENSITIVE_NAMES:
        return True

    if name == ".env" or name.startswith(".env."):
        return True

    if name.endswith((".pem", ".key", ".p12", ".pfx")):
        return True

    return False


def collect_project_context(
    project_root: str | Path,
    *,
    max_files: int = DEFAULT_MAX_FILES,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
    include_hidden: bool = False,
) -> list[ContextDocument]:
    """Collect bounded UTF-8 source files while excluding common secrets.

    Files are returned in deterministic relative-path order. Symlinks,
    binary files, ignored directories, and files exceeding configured
    limits are skipped.
    """
    if max_files < 1:
        raise ValueError("max_files must be at least 1")
    if max_file_bytes < 1:
        raise ValueError("max_file_bytes must be at least 1")
    if max_total_bytes < 1:
        raise ValueError("max_total_bytes must be at least 1")

    root = resolve_project_root(project_root)
    candidates: list[Path] = []

    for current, directory_names, file_names in os.walk(
        root,
        topdown=True,
        followlinks=False,
    ):
        current_path = Path(current)

        directory_names[:] = sorted(
            name
            for name in directory_names
            if name.lower() not in IGNORED_DIRECTORIES
            and (include_hidden or not name.startswith("."))
            and not (current_path / name).is_symlink()
        )

        for name in sorted(file_names):
            path = current_path / name

            if path.is_symlink():
                continue
            if not include_hidden and name.startswith("."):
                continue
            if _is_sensitive_file(path):
                continue
            if path.suffix.lower() not in TEXT_EXTENSIONS:
                continue

            candidates.append(path)

    documents: list[ContextDocument] = []
    total_bytes = 0

    for path in sorted(candidates, key=lambda item: item.relative_to(root).as_posix()):
        if len(documents) >= max_files:
            break

        try:
            size = path.stat().st_size
            if size > max_file_bytes:
                continue
            if total_bytes + size > max_total_bytes:
                continue

            raw = path.read_bytes()

            # A file could have changed after stat().
            if len(raw) > max_file_bytes:
                continue
            if total_bytes + len(raw) > max_total_bytes:
                continue
            if b"\x00" in raw:
                continue

            content = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
        except (OSError, UnicodeDecodeError):
            continue

        relative_path = path.relative_to(root).as_posix()
        documents.append(
            ContextDocument(
                path=relative_path,
                content=content,
                size_bytes=len(raw),
            )
        )
        total_bytes += len(raw)

    return documents