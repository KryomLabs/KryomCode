"""Provider-independent models for AI tool calling."""

import json
from dataclasses import dataclass
from typing import Any


def _validate_json_value(value: Any, *, field_name: str) -> None:
    """Reject values that cannot be represented as strict JSON."""
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"{field_name} must contain valid JSON-compatible data"
        ) from exc


@dataclass(frozen=True)
class ToolCall:
    """A normalized tool invocation requested by an AI provider."""

    call_id: str
    name: str
    arguments: dict[str, Any]

    def __post_init__(self) -> None:
        if not isinstance(self.call_id, str) or not self.call_id.strip():
            raise ValueError("call_id must be a non-empty string")

        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("name must be a non-empty string")

        if not isinstance(self.arguments, dict):
            raise ValueError("arguments must be a dictionary")

        if not all(isinstance(key, str) for key in self.arguments):
            raise ValueError("argument keys must be strings")

        _validate_json_value(self.arguments, field_name="arguments")


@dataclass(frozen=True)
class ToolResult:
    """A normalized result from executing one registered tool."""

    call_id: str
    name: str
    content: str
    is_error: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.call_id, str) or not self.call_id.strip():
            raise ValueError("call_id must be a non-empty string")

        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("name must be a non-empty string")

        if not isinstance(self.content, str):
            raise ValueError("content must be a string")

        if not isinstance(self.is_error, bool):
            raise ValueError("is_error must be a boolean")


@dataclass(frozen=True)
class ToolCallingResponse:
    """Normalized assistant output, including any requested tool calls."""

    content: str
    tool_calls: tuple[ToolCall, ...] = ()
    provider: str = ""
    model: str = ""
    finish_reason: str = "stop"

    def __post_init__(self) -> None:
        if not isinstance(self.content, str):
            raise ValueError("content must be a string")

        if not isinstance(self.tool_calls, (tuple, list)):
            raise ValueError("tool_calls must be a tuple or list")

        calls = tuple(self.tool_calls)

        if not all(isinstance(call, ToolCall) for call in calls):
            raise TypeError("Every tool call must be a ToolCall")

        call_ids = [call.call_id for call in calls]
        if len(call_ids) != len(set(call_ids)):
            raise ValueError("Tool call IDs must be unique within a response")

        object.__setattr__(self, "tool_calls", calls)

        for field_name in ("provider", "model", "finish_reason"):
            value = getattr(self, field_name)
            if not isinstance(value, str):
                raise ValueError(f"{field_name} must be a string")