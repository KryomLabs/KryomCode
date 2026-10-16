"""Provider-independent interfaces for AI generation in KryomCode."""

from dataclasses import dataclass
from typing import Literal, Protocol

MessageRole = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class ChatMessage:
    """A single message in a model conversation."""

    role: MessageRole
    content: str

    def __post_init__(self) -> None:
        if self.role not in {"system", "user", "assistant"}:
            raise ValueError(f"Unsupported message role: {self.role!r}")

        if not isinstance(self.content, str) or not self.content.strip():
            raise ValueError("Message content must be a non-empty string")


@dataclass(frozen=True)
class GenerationRequest:
    """Normalized request shared by all AI providers."""

    model: str
    messages: tuple[ChatMessage, ...]
    temperature: float = 0.2
    max_output_tokens: int = 2048

    def __post_init__(self) -> None:
        if not isinstance(self.model, str) or not self.model.strip():
            raise ValueError("model must be a non-empty string")

        if not isinstance(self.messages, (tuple, list)):
            raise ValueError("messages must be a tuple or list of ChatMessage")

        messages = tuple(self.messages)
        if not messages:
            raise ValueError("messages must contain at least one message")

        if not all(isinstance(message, ChatMessage) for message in messages):
            raise TypeError("Every message must be a ChatMessage")

        object.__setattr__(self, "messages", messages)

        if isinstance(self.temperature, bool) or not isinstance(
            self.temperature, (int, float)
        ):
            raise ValueError("temperature must be a number")

        if not 0.0 <= self.temperature <= 2.0:
            raise ValueError("temperature must be between 0.0 and 2.0")

        if (
            isinstance(self.max_output_tokens, bool)
            or not isinstance(self.max_output_tokens, int)
            or self.max_output_tokens < 1
        ):
            raise ValueError("max_output_tokens must be a positive integer")


@dataclass(frozen=True)
class GenerationResponse:
    """Normalized result returned by an AI provider."""

    content: str
    provider: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.content, str):
            raise ValueError("content must be a string")

        if not isinstance(self.provider, str) or not self.provider.strip():
            raise ValueError("provider must be a non-empty string")

        if not isinstance(self.model, str) or not self.model.strip():
            raise ValueError("model must be a non-empty string")

        for name, value in (
            ("input_tokens", self.input_tokens),
            ("output_tokens", self.output_tokens),
        ):
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, int)
                or value < 0
            ):
                raise ValueError(f"{name} must be a non-negative integer or None")


class AIProvider(Protocol):
    """Contract that every KryomCode AI provider must implement."""

    @property
    def name(self) -> str:
        """Return a stable provider identifier."""
        ...

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        """Generate a response using the configured model."""
        ...
