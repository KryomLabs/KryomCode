import pytest

from kryomcode.core.project import (
    resolve_project_path,
    resolve_project_root,
)


def test_resolve_project_root_returns_absolute_directory(tmp_path):
    root = resolve_project_root(tmp_path)

    assert root.is_absolute()
    assert root.is_dir()


def test_resolve_project_root_rejects_missing_directory(tmp_path):
    missing = tmp_path / "missing"

    with pytest.raises(FileNotFoundError):
        resolve_project_root(missing)


def test_resolve_project_root_rejects_file(tmp_path):
    file_path = tmp_path / "file.txt"
    file_path.write_text("hello", encoding="utf-8")

    with pytest.raises(NotADirectoryError):
        resolve_project_root(file_path)


def test_resolve_relative_path_inside_project(tmp_path):
    file_path = tmp_path / "hello.py"
    file_path.write_text("print('hello')", encoding="utf-8")

    result = resolve_project_path(
        tmp_path,
        "hello.py",
        must_exist=True,
    )

    assert result == file_path.resolve()


def test_rejects_parent_directory_traversal(tmp_path):
    root = tmp_path / "project"
    root.mkdir()

    with pytest.raises(ValueError, match="outside the project root"):
        resolve_project_path(root, "../outside.txt")


def test_rejects_absolute_path_outside_project(tmp_path):
    root = tmp_path / "project"
    root.mkdir()

    outside = tmp_path / "outside.txt"

    with pytest.raises(ValueError, match="outside the project root"):
        resolve_project_path(root, outside)