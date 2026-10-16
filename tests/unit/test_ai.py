import pytest

from kryomcode.ai.context import collect_project_context


def test_collects_text_files_in_deterministic_order(tmp_path):
    (tmp_path / "z.py").write_text("z = 1\n", encoding="utf-8")
    (tmp_path / "a.py").write_text("a = 1\n", encoding="utf-8")

    documents = collect_project_context(tmp_path)

    assert [document.path for document in documents] == ["a.py", "z.py"]
    assert documents[0].content == "a = 1\n"


def test_excludes_common_secrets_and_virtual_environments(tmp_path):
    (tmp_path / ".env").write_text("API_KEY=secret", encoding="utf-8")
    (tmp_path / "app.py").write_text("print('safe')", encoding="utf-8")

    virtual_env = tmp_path / ".venv" / "Lib"
    virtual_env.mkdir(parents=True)
    (virtual_env / "package.py").write_text("ignored = True", encoding="utf-8")

    documents = collect_project_context(tmp_path, include_hidden=True)

    assert [document.path for document in documents] == ["app.py"]


def test_ignores_unsupported_extensions(tmp_path):
    (tmp_path / "app.py").write_text("print('hello')", encoding="utf-8")
    (tmp_path / "image.png").write_bytes(b"\x89PNG\r\n")

    documents = collect_project_context(tmp_path)

    assert [document.path for document in documents] == ["app.py"]


def test_skips_files_over_per_file_limit(tmp_path):
    (tmp_path / "large.py").write_text("x" * 20, encoding="utf-8")
    (tmp_path / "small.py").write_text("ok", encoding="utf-8")

    documents = collect_project_context(tmp_path, max_file_bytes=10)

    assert [document.path for document in documents] == ["small.py"]


def test_respects_total_byte_limit(tmp_path):
    (tmp_path / "a.py").write_text("12345", encoding="utf-8")
    (tmp_path / "b.py").write_text("67890", encoding="utf-8")

    documents = collect_project_context(tmp_path, max_total_bytes=5)

    assert len(documents) == 1
    assert documents[0].path == "a.py"


def test_respects_file_count_limit(tmp_path):
    for name in ("a.py", "b.py", "c.py"):
        (tmp_path / name).write_text("pass\n", encoding="utf-8")

    documents = collect_project_context(tmp_path, max_files=2)

    assert [document.path for document in documents] == ["a.py", "b.py"]


def test_skips_binary_content(tmp_path):
    (tmp_path / "binary.py").write_bytes(b"print('x')\x00")
    (tmp_path / "valid.py").write_text("print('ok')", encoding="utf-8")

    documents = collect_project_context(tmp_path)

    assert [document.path for document in documents] == ["valid.py"]


@pytest.mark.parametrize(
    "limits",
    [
        {"max_files": 0},
        {"max_file_bytes": 0},
        {"max_total_bytes": 0},
    ],
)
def test_rejects_non_positive_limits(tmp_path, limits):
    with pytest.raises(ValueError):
        collect_project_context(tmp_path, **limits)