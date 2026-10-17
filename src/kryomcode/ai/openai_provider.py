"""OpenAI Responses API adapter for KryomCode."""

import os
from typing import Any

from kryomcode.ai.providers import (
    GenerationRequest,
    GenerationResponse,
)


class OpenAIProvider:
    """Implement the KryomCode provider interface using OpenAI."""

    name = "openai"

    def __init__(
        self,
        client: Any | None = None,
        *,
        api_key: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        """Initialize with an injected client or create an official SDK client.

        API keys should normally come from the OPENAI_API_KEY environment
        variable. An injected client makes testing possible without a key.
        """
        if client is not None:
            self._client = client
            return

        key = api_key or os.environ.get("OPENAI_API_KEY")
        if not key or not key.strip():
            raise ValueError(
                "OpenAI API key is required. Set OPENAI_API_KEY "
                "or pass api_key explicitly."
            )

        if timeout <= 0:
            raise ValueError("timeout must be greater than zero")

        try:
            from openai import OpenAI
        except ImportError as exc:
            raise ImportError(
                "OpenAI support is optional. Install it with "
                "'.\\.venv\\Scripts\\python.exe -m pip install -e \".[openai]\"'."
            ) from exc

        self._client = OpenAI(
            api_key=key,
            timeout=timeout,
        )

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        """Generate text and normalize the OpenAI response."""
        response = self._client.responses.create(
            model=request.model,
            input=[
                {
                    "role": message.role,
                    "content": message.content,
                }
                for message in request.messages
            ],
            temperature=request.temperature,
            max_output_tokens=request.max_output_tokens,
        )

        content = getattr(response, "output_text", None)
        if not isinstance(content, str):
            raise RuntimeError(
                "OpenAI returned no usable output_text string."
            )

        usage = getattr(response, "usage", None)

        input_tokens = getattr(usage, "input_tokens", None)
        output_tokens = getattr(usage, "output_tokens", None)

        return GenerationResponse(
            content=content,
            provider=self.name,
            model=request.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )