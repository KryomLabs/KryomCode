// Shared jsdom setup for the renderer harness. Components query
// matchMedia (motion preferences); jsdom does not implement it.
if (
  typeof window !== 'undefined' &&
  typeof window.matchMedia !== 'function'
) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}
