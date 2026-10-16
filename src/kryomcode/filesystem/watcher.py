"""Polling-based project filesystem watcher."""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from threading import Event

from kryomcode.filesystem.reader import list_directory


@dataclass(frozen=True)
class FileChange:
    """A detected filesystem change."""

    event_type: str
    path: str


def snapshot_directory(
    project_root: str | Path,
    target: str | Path = ".",
    *,
    recursive: bool = True,
    include_hidden: bool = False,
) -> dict[str, tuple[int, int]]:
    """Capture relative file paths and their modification signatures."""
    root = Path(project_root).expanduser().resolve(strict=True)

    entries = list_directory(
        root,
        target,
        recursive=recursive,
        include_hidden=include_hidden,
    )

    snapshot: dict[str, tuple[int, int]] = {}

    for path in entries:
        if not path.is_file() or path.is_symlink():
            continue

        stat = path.stat()
        relative_path = path.relative_to(root).as_posix()
        snapshot[relative_path] = (stat.st_mtime_ns, stat.st_size)

    return snapshot


def detect_changes(
    previous: Mapping[str, tuple[int, int]],
    current: Mapping[str, tuple[int, int]],
) -> list[FileChange]:
    """Compare snapshots and return deterministic change events."""
    changes: list[FileChange] = []

    for path in sorted(previous.keys() - current.keys()):
        changes.append(FileChange("deleted", path))

    for path in sorted(current.keys() - previous.keys()):
        changes.append(FileChange("created", path))

    for path in sorted(previous.keys() & current.keys()):
        if previous[path] != current[path]:
            changes.append(FileChange("modified", path))

    return changes


def watch_directory(
    project_root: str | Path,
    target: str | Path = ".",
    *,
    interval: float = 1.0,
    recursive: bool = True,
    include_hidden: bool = False,
    stop_event: Event | None = None,
) -> Iterator[FileChange]:
    """Yield file changes until the optional stop event is set.

    The initial snapshot establishes a baseline; existing files do not
    generate creation events when watching begins.
    """
    if interval <= 0:
        raise ValueError("interval must be greater than zero")

    stop = stop_event if stop_event is not None else Event()

    previous = snapshot_directory(
        project_root,
        target,
        recursive=recursive,
        include_hidden=include_hidden,
    )

    while not stop.is_set():
        if stop.wait(interval):
            break

        current = snapshot_directory(
            project_root,
            target,
            recursive=recursive,
            include_hidden=include_hidden,
        )

        yield from detect_changes(previous, current)
        previous = current