"""OpenAI Responses API adapter for KryomCode."""

import json
import os
from typing import Any

from kryomcode.ai.providers import (
    GenerationRequest,
    GenerationResponse,
)
from kryomcode.ai.tool_calling import (
    ToolCall,
    ToolCallingResponse,
    ToolResult,
)
from kryomcode.ai.tools import ToolRegistry


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
        """Initialize with an injected client or create an official SDK client."""
        if timeout <= 0:
            raise ValueError("timeout must be greater than zero")

        if client is not None:
            self._client = client
            return

        key = api_key or os.environ.get("OPENAI_API_KEY")
        if not key or not key.strip():
            raise ValueError(
                "OpenAI API key is required. Set OPENAI_API_KEY "
                "or pass api_key explicitly."
            )

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

        return GenerationResponse(
            content=content,
            provider=self.name,
            model=request.model,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )

    def generate_with_tools(
        self,
        request: GenerationRequest,
        tool_registry: ToolRegistry,
        *,
        max_tool_iterations: int = 5,
    ) -> ToolCallingResponse:
        """Generate a response while executing approved registered tools."""
        if not isinstance(tool_registry, ToolRegistry):
            raise TypeError("tool_registry must be a ToolRegistry")

        if (
            isinstance(max_tool_iterations, bool)
            or not isinstance(max_tool_iterations, int)
            or not 1 <= max_tool_iterations <= 10
        ):
            raise ValueError(
                "max_tool_iterations must be between 1 and 10"
            )

        tools = [
            {
                "type": "function",
                "name": definition["name"],
                "description": definition["description"],
                "parameters": definition["parameters"],
            }
            for definition in tool_registry.definitions()
        ]

        conversation: list[Any] = [
            {
                "role": message.role,
                "content": message.content,
            }
            for message in request.messages
        ]

        executed_calls: list[ToolCall] = []

        for iteration in range(max_tool_iterations + 1):
            response = self._client.responses.create(
                model=request.model,
                input=conversation,
                tools=tools,
                temperature=request.temperature,
                max_output_tokens=request.max_output_tokens,
            )

            output_items = list(getattr(response, "output", None) or [])
            function_calls = [
                item
                for item in output_items
                if getattr(item, "type", None) == "function_call"
            ]

            if not function_calls:
                content = getattr(response, "output_text", None)
                if not isinstance(content, str):
                    raise RuntimeError(
                        "OpenAI returned no usable output_text string."
                    )

                return ToolCallingResponse(
                    content=content,
                    tool_calls=tuple(executed_calls),
                    provider=self.name,
                    model=request.model,
                    finish_reason="stop",
                )

            if iteration >= max_tool_iterations:
                raise RuntimeError(
                    "Maximum tool-call iterations reached."
                )

            # Preserve the provider response items for the next turn.
            conversation.extend(output_items)

            for item in function_calls:
                call_id = getattr(item, "call_id", None)
                name = getattr(item, "name", None)
                raw_arguments = getattr(item, "arguments", None)

                if (
                    not isinstance(call_id, str)
                    or not call_id.strip()
                    or not isinstance(name, str)
                    or not name.strip()
                ):
                    raise RuntimeError(
                        "OpenAI returned a tool call without a valid ID or name."
                    )

                try:
                    if not isinstance(raw_arguments, str):
                        raise ValueError(
                            "Tool arguments must be a JSON string."
                        )

                    arguments = json.loads(raw_arguments)

                    if not isinstance(arguments, dict):
                        raise ValueError(
                            "Tool arguments must decode to a JSON object."
                        )

                    call = ToolCall(
                        call_id=call_id,
                        name=name,
                        arguments=arguments,
                    )
                    executed_calls.append(call)

                    value = tool_registry.execute(name, arguments)
                    result = ToolResult(
                        call_id=call_id,
                        name=name,
                        content=json.dumps(
                            value,
                            ensure_ascii=False,
                            default=str,
                        ),
                    )
                except Exception as exc:
                    result = ToolResult(
                        call_id=call_id,
                        name=name,
                        content=json.dumps(
                            {
                                "error": type(exc).__name__,
                                "message": str(exc),
                            },
                            ensure_ascii=False,
                        ),
                        is_error=True,
                    )

                conversation.append(
                    {
                        "type": "function_call_output",
                        "call_id": result.call_id,
                        "output": result.content,
                    }
                )

        raise RuntimeError("Tool-calling loop exited unexpectedly.")