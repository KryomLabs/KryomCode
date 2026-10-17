"""Anthropic Messages API adapter for KryomCode."""

import os
from typing import Any

from kryomcode.ai.providers import (
    GenerationRequest,
    GenerationResponse,
)


class AnthropicProvider:
    """Implement the KryomCode provider interface using Anthropic."""

    name = "anthropic"

    def __init__(
        self,
        client: Any | None = None,
        *,
        api_key: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        """Initialize an injected client or create an Anthropic SDK client."""
        if timeout <= 0:
            raise ValueError("timeout must be greater than zero")

        if client is not None:
            self._client = client
            return

        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key or not key.strip():
            raise ValueError(
                "Anthropic API key is required. Set ANTHROPIC_API_KEY "
                "or pass api_key explicitly."
            )

        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise ImportError(
                "Anthropic support is optional. Install it with "
                "'.\\.venv\\Scripts\\python.exe -m pip install -e "
                "\".[anthropic]\"'."
            ) from exc

        self._client = Anthropic(
            api_key=key,
            timeout=timeout,
        )

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        """Generate text and normalize the Anthropic response."""
        system_messages = [
            message.content
            for message in request.messages
            if message.role == "system"
        ]
        conversation_messages = [
            {
                "role": message.role,
                "content": message.content,
            }
            for message in request.messages
            if message.role in {"user", "assistant"}
        ]

        if not conversation_messages:
            raise ValueError(
                "Anthropic requests require at least one user or assistant "
                "message; system messages alone are not sufficient."
            )

        parameters: dict[str, Any] = {
            "model": request.model,
            "messages": conversation_messages,
            "max_tokens": request.max_output_tokens,
            "temperature": request.temperature,
        }

        if system_messages:
            parameters["system"] = "\n\n".join(system_messages)

        response = self._client.messages.create(**parameters)

        content_blocks = getattr(response, "content", None)
        if not isinstance(content_blocks, (list, tuple)):
            raise RuntimeError(
                "Anthropic returned no usable content blocks."
            )

        text_parts = [
            block.text
            for block in content_blocks
            if getattr(block, "type", None) == "text"
            and isinstance(getattr(block, "text", None), str)
        ]

        if not text_parts:
            raise RuntimeError(
                "Anthropic returned no usable text content."
            )

        usage = getattr(response, "usage", None)

        return GenerationResponse(
            content="".join(text_parts),
            provider=self.name,
            model=request.model,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )