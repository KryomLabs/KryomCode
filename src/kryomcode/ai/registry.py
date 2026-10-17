"""Provider registry for KryomCode AI generation."""

from kryomcode.ai.providers import AIProvider, GenerationRequest, GenerationResponse

class ProviderNotFoundError(LookupError):
    """Raised when a requested AI provider is not registered."""


class DuplicateProviderError(ValueError):
    """Raised when a provider name is already registered."""


class AIProviderRegistry:
    """Register and retrieve AI providers by their stable names."""

    def __init__(self) -> None:
        self._providers: dict[str, AIProvider] = {}

    def register(
        self,
        provider: AIProvider,
        *,
        replace: bool = False,
    ) -> None:
        """Register a provider, optionally replacing an existing provider."""
        name = getattr(provider, "name", None)
        generate = getattr(provider, "generate", None)

        if not isinstance(name, str) or not name.strip():
            raise ValueError("Provider name must be a non-empty string")

        if not callable(generate):
            raise TypeError("Provider must implement a callable generate method")

        name = name.strip()

        if name in self._providers and not replace:
            raise DuplicateProviderError(
                f"Provider {name!r} is already registered"
            )

        self._providers[name] = provider

    def get(self, name: str) -> AIProvider:
        """Return a registered provider by name."""
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Provider name must be a non-empty string")

        normalized_name = name.strip()

        try:
            return self._providers[normalized_name]
        except KeyError as exc:
            available = ", ".join(self.provider_names) or "(none)"
            raise ProviderNotFoundError(
                f"Provider {normalized_name!r} is not registered. "
                f"Available providers: {available}"
            ) from exc

    @property
    def provider_names(self) -> tuple[str, ...]:
        """Return registered provider names in sorted order."""
        return tuple(sorted(self._providers))

    def generate(
        self,
        provider_name: str,
        request: GenerationRequest,
    ) -> GenerationResponse:
        """Generate a response using the selected provider."""
        provider = self.get(provider_name)
        return provider.generate(request)