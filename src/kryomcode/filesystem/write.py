"""Controlled text-file writing for KryomCode."""

import os
import tempfile
from pathlib import Path

from kryomcode.core.project import resolve_project_path


def write_text_file(
    project_root: str | Path,
    target: str | Path,
    content: str,
    *,
    overwrite: bool = False,
    create_parents: bool = False,
    encoding: str = "utf-8",
) -> Path:
    """Write text inside a project root.

    Existing files are protected unless overwrite=True.
    Writes use a temporary file in the destination directory.
    """
    if not isinstance(content, str):
        raise TypeError("content must be a string")

    destination = resolve_project_path(
        project_root,
        target,
        must_exist=False,
    )

    if destination == resolve_project_path(project_root, "."):
        raise ValueError("Cannot write a file over the project root")

    parent = destination.parent

    if not parent.is_dir():
        if not create_parents:
            raise FileNotFoundError(
                f"Parent directory does not exist: {parent}"
            )
        parent.mkdir(parents=True, exist_ok=True)

    # Recheck containment after optional directory creation.
    destination = resolve_project_path(
        project_root,
        destination,
        must_exist=False,
    )

    if destination.exists() and destination.is_dir():
        raise IsADirectoryError(
            f"Destination is a directory: {destination}"
        )

    if destination.is_symlink():
        raise ValueError("Writing through symbolic links is not allowed")

    temporary_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding=encoding,
            newline="",
            dir=parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())

        if overwrite:
            os.replace(temporary_path, destination)
            temporary_path = None
        else:
            # Atomic creation: fail if the destination already exists.
            # Both paths are in the same directory/filesystem.
            os.link(temporary_path, destination)
            temporary_path.unlink()
            temporary_path = None

        return destination

    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)