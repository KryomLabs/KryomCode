"""Controlled, read-only project tools for KryomCode."""

import re
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from kryomcode.ai.context import (
    IGNORED_DIRECTORIES,
    SENSITIVE_NAMES,
    TEXT_EXTENSIONS,
)
from kryomcode.core.project import resolve_project_path, resolve_project_root
from kryomcode.filesystem.reader import list_directory, read_text_file


class UnknownToolError(LookupError):
    """Raised when a tool name is not registered."""


class InvalidToolArguments(ValueError):
    """Raised when tool arguments do not match the declared schema."""


@dataclass(frozen=True)
class ToolDefinition:
    """A tool's public schema and its controlled local handler."""

    name: str
    description: str
    parameters: dict[str, object]
    handler: Callable[[dict[str, object]], object] = field(
        repr=False,
        compare=False,
    )

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not re.fullmatch(
            r"[a-z][a-z0-9_]{0,63}", self.name
        ):
            raise ValueError("Tool name must be a valid lowercase identifier")

        if not isinstance(self.description, str) or not self.description.strip():
            raise ValueError("Tool description must be non-empty")

        if not isinstance(self.parameters, dict):
            raise TypeError("Tool parameters must be a dictionary")

        if self.parameters.get("type") != "object":
            raise ValueError("Tool parameters schema must have type 'object'")

        if not isinstance(self.parameters.get("properties", {}), dict):
            raise ValueError("Tool schema properties must be a dictionary")

        if not callable(self.handler):
            raise TypeError("Tool handler must be callable")


class ToolRegistry:
    """Register tools explicitly and validate arguments before execution."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    @property
    def tool_names(self) -> tuple[str, ...]:
        """Return registered tool names in deterministic order."""
        return tuple(sorted(self._tools))

    def register(self, tool: ToolDefinition) -> None:
        """Register a tool without silently replacing an existing one."""
        if not isinstance(tool, ToolDefinition):
            raise TypeError("tool must be a ToolDefinition")

        if tool.name in self._tools:
            raise ValueError(f"Tool {tool.name!r} is already registered")

        self._tools[tool.name] = tool

    def definitions(self) -> list[dict[str, object]]:
        """Return public tool descriptions without exposing Python handlers."""
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": deepcopy(tool.parameters),
            }
            for tool in (self._tools[name] for name in self.tool_names)
        ]

    def execute(
        self,
        name: str,
        arguments: dict[str, object],
    ) -> object:
        """Execute one registered tool after validating its arguments."""
        if not isinstance(name, str) or not name.strip():
            raise UnknownToolError("Tool name must be a non-empty string")

        try:
            tool = self._tools[name.strip()]
        except KeyError as exc:
            raise UnknownToolError(
                f"Unknown tool {name!r}. Available tools: "
                f"{', '.join(self.tool_names) or '(none)'}"
            ) from exc

        if not isinstance(arguments, dict):
            raise InvalidToolArguments("Tool arguments must be an object")

        schema = tool.parameters
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        if not isinstance(properties, dict) or not isinstance(required, list):
            raise InvalidToolArguments("Tool schema is invalid")

        missing = [key for key in required if key not in arguments]
        if missing:
            raise InvalidToolArguments(
                f"Missing required arguments: {', '.join(missing)}"
            )

        allow_extra = schema.get("additionalProperties", False)
        extra = set(arguments) - set(properties)
        if extra and allow_extra is False:
            raise InvalidToolArguments(
                f"Unexpected arguments: {', '.join(sorted(extra))}"
            )

        validated = dict(arguments)

        for key, rule in properties.items():
            if not isinstance(rule, dict):
                raise InvalidToolArguments(f"Invalid schema for {key!r}")

            if key not in validated:
                if "default" in rule:
                    validated[key] = rule["default"]
                continue

            value = validated[key]
            expected = rule.get("type")

            type_matches = {
                "string": lambda item: isinstance(item, str),
                "integer": lambda item: isinstance(item, int)
                and not isinstance(item, bool),
                "boolean": lambda item: isinstance(item, bool),
            }

            if expected in type_matches and not type_matches[expected](value):
                raise InvalidToolArguments(
                    f"Argument {key!r} must be of type {expected}"
                )

            if expected == "string" and "enum" in rule:
                if value not in rule["enum"]:
                    raise InvalidToolArguments(
                        f"Argument {key!r} has an unsupported value"
                    )

            if expected == "integer":
                if "minimum" in rule and value < rule["minimum"]:
                    raise InvalidToolArguments(
                        f"Argument {key!r} is below its minimum"
                    )
                if "maximum" in rule and value > rule["maximum"]:
                    raise InvalidToolArguments(
                        f"Argument {key!r} exceeds its maximum"
                    )

        return tool.handler(validated)


def _is_sensitive_path(path: Path) -> bool:
    """Reject common secret files and hidden or generated paths."""
    if any(part.startswith(".") for part in path.parts):
        return True

    if any(part.lower() in IGNORED_DIRECTORIES for part in path.parts):
        return True

    name = path.name.lower()

    if name in SENSITIVE_NAMES:
        return True

    if name == ".env" or name.startswith(".env."):
        return True

    return name.endswith((".pem", ".key", ".p12", ".pfx"))


def _safe_read_target(project_root: Path, target: str) -> Path:
    """Resolve a readable text file while rejecting unsafe path components."""
    if not isinstance(target, str) or not target.strip():
        raise ValueError("path must be a non-empty string")

    requested = Path(target)

    if ".." in requested.parts:
        raise ValueError("Parent-directory traversal is not allowed")

    candidate = requested if requested.is_absolute() else project_root / requested

    try:
        relative = candidate.relative_to(project_root)
    except ValueError as exc:
        raise ValueError("Target is outside the project root") from exc

    if _is_sensitive_path(relative):
        raise ValueError("Hidden, generated, or sensitive paths are not readable")

    if relative.suffix.lower() not in TEXT_EXTENSIONS:
        raise ValueError("Only supported text-file extensions can be read")

    current = project_root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Reading through symbolic links is not allowed")

    resolved = resolve_project_path(
        project_root,
        candidate,
        must_exist=True,
    )

    if not resolved.is_file():
        raise ValueError("Target must be a regular text file")

    return resolved


def create_project_tool_registry(project_root: str | Path) -> ToolRegistry:
    """Create a registry containing bounded, read-only project tools."""
    root = resolve_project_root(project_root)
    registry = ToolRegistry()

    def list_files(args: dict[str, object]) -> dict[str, object]:
        target = str(args["path"])
        max_entries = int(args["max_entries"])

        if max_entries < 1 or max_entries > 200:
            raise ValueError("max_entries must be between 1 and 200")

        entries = list_directory(
            root,
            target,
            recursive=False,
            include_hidden=False,
            max_entries=max_entries,
        )

        safe_entries: list[dict[str, str]] = []

        for entry in entries:
            relative = entry.relative_to(root)

            if _is_sensitive_path(relative):
                continue

            safe_entries.append(
                {
                    "path": relative.as_posix(),
                    "type": "directory" if entry.is_dir() else "file",
                }
            )

        return {"entries": safe_entries}

    def read_file(args: dict[str, object]) -> dict[str, object]:
        target = str(args["path"])
        max_bytes = int(args["max_bytes"])

        if max_bytes < 1 or max_bytes > 100_000:
            raise ValueError("max_bytes must be between 1 and 100000")

        safe_path = _safe_read_target(root, target)
        content = read_text_file(
            root,
            safe_path,
            max_bytes=max_bytes,
        )

        return {
            "path": safe_path.relative_to(root).as_posix(),
            "content": content,
            "bytes": len(content.encode("utf-8")),
        }

    registry.register(
        ToolDefinition(
            name="list_project_files",
            description="List safe, non-hidden entries in one project directory.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "default": ".",
                    },
                    "max_entries": {
                        "type": "integer",
                        "default": 100,
                        "minimum": 1,
                        "maximum": 200,
                    },
                },
                "additionalProperties": False,
            },
            handler=list_files,
        )
    )

    registry.register(
        ToolDefinition(
            name="read_project_file",
            description="Read a supported text file inside the project root.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "max_bytes": {
                        "type": "integer",
                        "default": 50_000,
                        "minimum": 1,
                        "maximum": 100_000,
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
            handler=read_file,
        )
    )

    return registry