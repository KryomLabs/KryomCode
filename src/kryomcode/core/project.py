"""Safe project-root and project-path resolution utilities."""

from pathlib import Path


def resolve_project_root(path: str | Path) -> Path:
    """Return an existing project root as an absolute resolved path."""
    root = Path(path).expanduser().resolve(strict=True)

    if not root.is_dir():
        raise NotADirectoryError(f"Project root is not a directory: {root}")

    return root


def resolve_project_path(
    project_root: str | Path,
    target: str | Path,
    *,
    must_exist: bool = False,
) -> Path:
    """Resolve a target and reject paths outside the project root.

    Relative targets are interpreted relative to the project root.
    Existing symlinks are resolved before checking containment.
    """
    root = resolve_project_root(project_root)
    candidate = Path(target).expanduser()

    if not candidate.is_absolute():
        candidate = root / candidate

    resolved = candidate.resolve(strict=must_exist)

    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(
            f"Target is outside the project root: {target}"
        ) from exc

    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Target does not exist: {resolved}")

    return resolved