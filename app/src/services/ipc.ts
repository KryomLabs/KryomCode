/**
 * Safe access to the Electron preload bridge.
 * Renderer code must use the exposed API, never Node.js APIs directly.
 */

export function isKryomCodeAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.kryomcode !== "undefined"
  );
}

export function getKryomCodeAPI(): KryomCodeAPI {
  if (!isKryomCodeAvailable()) {
    throw new Error(
      "KryomCode desktop bridge is unavailable. Launch the app through Electron.",
    );
  }

  return window.kryomcode;
}