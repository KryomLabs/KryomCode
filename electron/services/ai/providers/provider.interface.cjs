// Provider contract for KryomCode AI backends.
//
// A provider is any object with an async chat method:
//
//   await provider.chat({ model, messages, signal })
//
// Arguments:
// - model: string. A validated Meta model ID such as 'muse-spark-1.3'.
//   Providers must not accept arbitrary model IDs from untrusted input.
// - messages: array of { role, content } entries where role is 'system',
//   'user', or 'assistant' and content is a non-empty string.
// - signal: optional AbortSignal. When aborted, the provider should stop
//   promptly and report cancellation.
//
// Result: { answer, model } where answer is the assistant's non-empty
// reply text and model is the ID of the model that produced it.
//
// Errors: providers throw Error instances with user-safe messages.
// Messages must never include API keys, authorization headers, or other
// secrets. Full prompts must not be echoed into errors or logs.

function assertImplementsProvider(candidate, name = 'provider') {
  if (
    !candidate ||
    typeof candidate.chat !== 'function'
  ) {
    throw new TypeError(
      `${name} must implement an async chat({ model, messages, signal }) method.`
    )
  }
}

module.exports = {
  assertImplementsProvider,
}
