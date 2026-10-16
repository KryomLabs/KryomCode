import pytest

from kryomcode.filesystem.reader import (
    list_directory,
    read_text_file,
)
from kryomcode.filesystem.watcher import (
    detect_changes,
    snapshot_directory,
)
from kryomcode.filesystem.write import write_text_file


def test_read_text_file(tmp_path):
    (tmp_path / "hello.txt").write_text("Hello KryomCode", encoding="utf-8")

    result = read_text_file(tmp_path, "hello.txt")

    assert result == "Hello KryomCode"


def test_read_text_file_rejects_path_outside_project(tmp_path):
    root = tmp_path / "project"
    root.mkdir()

    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")

    with pytest.raises(ValueError, match="outside the project root"):
        read_text_file(root, outside)


def test_read_text_file_enforces_size_limit(tmp_path):
    (tmp_path / "large.txt").write_text("123456", encoding="utf-8")

    with pytest.raises(ValueError, match="exceeds"):
        read_text_file(tmp_path, "large.txt", max_bytes=5)


def test_list_directory_returns_sorted_entries(tmp_path):
    (tmp_path / "z.txt").touch()
    (tmp_path / "a.txt").touch()
    (tmp_path / "folder").mkdir()

    result = list_directory(tmp_path)

    assert [path.name for path in result] == [
        "a.txt",
        "folder",
        "z.txt",
    ]


def test_list_directory_recursive(tmp_path):
    nested = tmp_path / "folder" / "nested"
    nested.mkdir(parents=True)
    (nested / "file.txt").touch()

    result = list_directory(tmp_path, recursive=True)

    assert {path.relative_to(tmp_path).as_posix() for path in result} == {
        "folder",
        "folder/nested",
        "folder/nested/file.txt",
    }


def test_list_directory_excludes_hidden_entries_by_default(tmp_path):
    (tmp_path / ".secret").touch()
    (tmp_path / "visible.txt").touch()

    result = list_directory(tmp_path)

    assert [path.name for path in result] == ["visible.txt"]


def test_list_directory_enforces_entry_limit(tmp_path):
    (tmp_path / "a.txt").touch()
    (tmp_path / "b.txt").touch()

    with pytest.raises(ValueError, match="exceeds"):
        list_directory(tmp_path, max_entries=1)


def test_write_text_file_creates_file(tmp_path):
    result = write_text_file(
        tmp_path,
        "src/hello.py",
        'print("hello")',
        create_parents=True,
    )

    assert result.read_text(encoding="utf-8") == 'print("hello")'


def test_write_text_file_refuses_overwrite_by_default(tmp_path):
    target = tmp_path / "hello.txt"
    target.write_text("original", encoding="utf-8")

    with pytest.raises(FileExistsError):
        write_text_file(tmp_path, "hello.txt", "replacement")

    assert target.read_text(encoding="utf-8") == "original"


def test_write_text_file_allows_explicit_overwrite(tmp_path):
    target = tmp_path / "hello.txt"
    target.write_text("original", encoding="utf-8")

    write_text_file(
        tmp_path,
        "hello.txt",
        "updated",
        overwrite=True,
    )

    assert target.read_text(encoding="utf-8") == "updated"


def test_write_text_file_rejects_path_outside_project(tmp_path):
    root = tmp_path / "project"
    root.mkdir()

    outside = tmp_path / "outside.txt"

    with pytest.raises(ValueError, match="outside the project root"):
        write_text_file(root, outside, "unsafe")


def test_write_text_file_requires_parent_by_default(tmp_path):
    with pytest.raises(FileNotFoundError):
        write_text_file(tmp_path, "missing/file.txt", "content")


def test_write_text_file_rejects_non_string_content(tmp_path):
    with pytest.raises(TypeError, match="content must be a string"):
        write_text_file(tmp_path, "hello.txt", 123)


def test_snapshot_directory_tracks_files(tmp_path):
    (tmp_path / "hello.txt").write_text("hello", encoding="utf-8")

    snapshot = snapshot_directory(tmp_path)

    assert "hello.txt" in snapshot
    assert snapshot["hello.txt"][1] == 5


def test_snapshot_directory_supports_nested_files(tmp_path):
    nested = tmp_path / "src"
    nested.mkdir()
    (nested / "main.py").write_text("print(1)", encoding="utf-8")

    snapshot = snapshot_directory(tmp_path, recursive=True)

    assert "src/main.py" in snapshot


def test_detect_changes_reports_created_modified_and_deleted():
    previous = {
        "deleted.txt": (100, 3),
        "modified.txt": (100, 3),
        "unchanged.txt": (100, 3),
    }
    current = {
        "created.txt": (200, 5),
        "modified.txt": (200, 3),
        "unchanged.txt": (100, 3),
    }

    changes = detect_changes(previous, current)

    assert [(change.event_type, change.path) for change in changes] == [
        ("deleted", "deleted.txt"),
        ("created", "created.txt"),
        ("modified", "modified.txt"),
    ]


def test_detect_changes_returns_empty_for_identical_snapshots():
    snapshot = {"hello.txt": (100, 5)}

    assert detect_changes(snapshot, snapshot) == []


def test_snapshot_directory_excludes_hidden_files(tmp_path):
    (tmp_path / ".secret").write_text("secret", encoding="utf-8")
    (tmp_path / "visible.txt").write_text("visible", encoding="utf-8")

    snapshot = snapshot_directory(tmp_path)

    assert ".secret" not in snapshot
    assert "visible.txt" in snapshot