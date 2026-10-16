"""Safe, read-only filesystem operations for KryomCode."""

from pathlib import Path

from kryomcode.core.project import resolve_project_path

DEFAULT_MAX_BYTES = 1_000_000


def list_directory(
    project_root: str | Path,
    target: str | Path = ".",
    *,
    recursive: bool = False,
    include_hidden: bool = False,
    max_entries: int = 10_000,
) -> list[Path]:
    """List project entries without following symbolic links."""
    if max_entries < 1:
        raise ValueError("max_entries must be at least 1")

    directory = resolve_project_path(
        project_root,
        target,
        must_exist=True,
    )

    if not directory.is_dir():
        raise NotADirectoryError(
            f"Target is not a directory: {directory}"
        )

    results: list[Path] = []
    pending = [directory]

    while pending:
        current = pending.pop()

        try:
            children = sorted(
                current.iterdir(),
                key=lambda item: item.name.casefold(),
            )
        except OSError as exc:
            raise OSError(
                f"Unable to list directory: {current}"
            ) from exc

        subdirectories: list[Path] = []

        for child in children:
            if not include_hidden and child.name.startswith("."):
                continue

            # Do not expose or traverse symbolic links.
            if child.is_symlink():
                continue

            safe_child = resolve_project_path(
                project_root,
                child,
                must_exist=True,
            )

            results.append(safe_child)

            if len(results) > max_entries:
                raise ValueError(
                    f"Directory listing exceeds {max_entries} entries"
                )

            if recursive and safe_child.is_dir():
                subdirectories.append(safe_child)

        # Reverse to preserve alphabetical traversal order.
        pending.extend(reversed(subdirectories))

        if not recursive:
            break

    return results


def read_text_file(
    project_root: str | Path,
    target: str | Path,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    encoding: str = "utf-8",
) -> str:
    """Read a project text file with a size limit."""
    if max_bytes < 1:
        raise ValueError("max_bytes must be at least 1")

    file_path = resolve_project_path(
        project_root,
        target,
        must_exist=True,
    )

    if not file_path.is_file():
        raise ValueError(f"Target is not a regular file: {file_path}")

    if file_path.stat().st_size > max_bytes:
        raise ValueError(
            f"File exceeds the {max_bytes}-byte read limit: {file_path}"
        )

    with file_path.open("rb") as file:
        content = file.read(max_bytes + 1)

    if len(content) > max_bytes:
        raise ValueError(
            f"File exceeds the {max_bytes}-byte read limit: {file_path}"
        )

    return content.decode(encoding)