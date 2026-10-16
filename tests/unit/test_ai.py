import pytest

from kryomcode.ai.context import ContextDocument, collect_project_context
from kryomcode.ai.selection import select_relevant_context

# ============================================================
# Project context collection tests
# ============================================================


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
    (virtual_env / "package.py").write_text(
        "ignored = True",
        encoding="utf-8",
    )

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


def test_context_collection_respects_total_byte_limit(tmp_path):
    (tmp_path / "a.py").write_text("12345", encoding="utf-8")
    (tmp_path / "b.py").write_text("67890", encoding="utf-8")

    documents = collect_project_context(tmp_path, max_total_bytes=5)

    assert len(documents) == 1
    assert documents[0].path == "a.py"


def test_context_collection_respects_file_count_limit(tmp_path):
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
def test_context_collection_rejects_non_positive_limits(tmp_path, limits):
    with pytest.raises(ValueError):
        collect_project_context(tmp_path, **limits)


# ============================================================
# Shared test helper for context selection
# ============================================================


def make_document(path, content, size_bytes=None):
    if size_bytes is None:
        size_bytes = len(content.encode("utf-8"))

    return ContextDocument(
        path=path,
        content=content,
        size_bytes=size_bytes,
    )


# ============================================================
# Task-aware context selection tests
# ============================================================


def test_ranks_relevant_files_first():
    auth = make_document(
        "src/auth.py",
        "Validate authentication tokens and permissions.",
    )
    billing = make_document(
        "src/billing.py",
        "Calculate invoices and payment totals.",
    )

    result = select_relevant_context(
        [billing, auth],
        "fix authentication token validation",
    )

    assert [doc.path for doc in result] == ["src/auth.py"]


def test_file_path_matches_help_determine_relevance():
    auth = make_document("src/auth.py", "def check(): pass")
    unrelated = make_document(
        "src/misc.py",
        "Authentication tokens require careful validation.",
    )

    result = select_relevant_context(
        [unrelated, auth],
        "change auth implementation",
    )

    assert result
    assert result[0].path == "src/auth.py"


def test_selection_results_are_deterministic_for_equal_scores():
    first = make_document("src/a_auth.py", "validate token")
    second = make_document("src/b_auth.py", "validate token")

    result = select_relevant_context(
        [second, first],
        "auth token validation",
    )

    assert [doc.path for doc in result] == [
        "src/a_auth.py",
        "src/b_auth.py",
    ]


def test_selection_excludes_documents_without_task_matches():
    document = make_document("src/billing.py", "calculate invoice totals")

    result = select_relevant_context(
        [document],
        "authentication tokens",
    )

    assert result == []


def test_selection_respects_file_count_limit():
    documents = [
        make_document("src/auth.py", "auth token validation"),
        make_document("src/token.py", "token validation"),
        make_document("src/security.py", "auth security checks"),
    ]

    result = select_relevant_context(
        documents,
        "auth token validation",
        max_files=2,
    )

    assert len(result) == 2


def test_selection_respects_total_byte_limit():
    first = make_document("src/auth.py", "auth token", size_bytes=6)
    second = make_document("src/token.py", "auth token", size_bytes=6)

    result = select_relevant_context(
        [first, second],
        "auth token",
        max_total_bytes=6,
    )

    assert len(result) == 1
    assert result[0].size_bytes == 6


def test_selection_rejects_empty_task():
    with pytest.raises(ValueError, match="task"):
        select_relevant_context([], "   ")


@pytest.mark.parametrize(
    "limits",
    [
        {"max_files": 0},
        {"max_total_bytes": 0},
    ],
)
def test_selection_rejects_non_positive_limits(limits):
    with pytest.raises(ValueError):
        select_relevant_context([], "authentication", **limits)


def test_selection_returns_empty_for_task_without_useful_tokens():
    document = make_document("src/app.py", "application startup")

    result = select_relevant_context([document], "a to in")

    assert result == []


# ============================================================
# AI engine context preparation tests
# ============================================================


def test_engine_prepares_context_for_task(tmp_path):
    from kryomcode.ai.engine import prepare_context

    (tmp_path / "auth.py").write_text(
        "def validate_token(token):\n    return bool(token)\n",
        encoding="utf-8",
    )
    (tmp_path / "billing.py").write_text(
        "def calculate_invoice():\n    return 100\n",
        encoding="utf-8",
    )

    package = prepare_context(
        tmp_path,
        "fix authentication token validation",
    )

    assert package.task == "fix authentication token validation"
    assert [doc.path for doc in package.documents] == ["auth.py"]
    assert package.total_bytes > 0


def test_engine_returns_immutable_document_collection(tmp_path):
    from kryomcode.ai.engine import ContextPackage, prepare_context

    (tmp_path / "auth.py").write_text(
        "authentication token validation",
        encoding="utf-8",
    )

    package = prepare_context(tmp_path, "authentication token")

    assert isinstance(package, ContextPackage)
    assert isinstance(package.documents, tuple)


def test_engine_formats_selected_files(tmp_path):
    from kryomcode.ai.engine import prepare_context

    (tmp_path / "auth.py").write_text(
        "def validate_token():\n    pass\n",
        encoding="utf-8",
    )

    package = prepare_context(tmp_path, "validate token")
    formatted = package.format_context()

    assert "--- BEGIN FILE: auth.py ---" in formatted
    assert "def validate_token():" in formatted
    assert "--- END FILE: auth.py ---" in formatted


def test_engine_returns_empty_package_when_no_files_match(tmp_path):
    from kryomcode.ai.engine import prepare_context

    (tmp_path / "billing.py").write_text(
        "calculate invoice totals",
        encoding="utf-8",
    )

    package = prepare_context(tmp_path, "authentication tokens")

    assert package.documents == ()
    assert package.total_bytes == 0
    assert package.format_context() == ""


def test_engine_rejects_empty_task_before_collecting(tmp_path):
    from kryomcode.ai.engine import prepare_context

    with pytest.raises(ValueError, match="task"):
        prepare_context(tmp_path, "   ")


def test_engine_respects_context_limits(tmp_path):
    from kryomcode.ai.engine import prepare_context

    (tmp_path / "auth.py").write_text(
        "auth token validation",
        encoding="utf-8",
    )
    (tmp_path / "token.py").write_text(
        "auth token handling",
        encoding="utf-8",
    )

    package = prepare_context(
        tmp_path,
        "auth token",
        max_context_files=1,
    )

    assert len(package.documents) <= 1
    assert package.total_bytes <= 200_000