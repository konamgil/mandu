/**
 * Fetch with a per-request deadline. This keeps an outer retry loop in control
 * instead of inheriting Bun's multi-minute default socket timeout.
 */
export function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
