/**
 * Hostname resolution helpers for CLI display URLs.
 *
 * The server may bind to a wildcard address (`0.0.0.0`, `::`) so that both
 * IPv4 and IPv6 clients can connect — but browsers cannot navigate to those
 * literals. For any user-facing URL (open-in-browser, runtime control,
 * onDevStart hook payload), we translate wildcards to `localhost` and bracket
 * bare IPv6 literals.
 *
 * See issue #190.
 */

/**
 * Resolve a hostname for display in URLs shown to the user.
 *
 * - `undefined` / `""` / `"0.0.0.0"` / `"::"` / `"[::]"` → `"localhost"`
 * - Bare IPv6 (`"::1"`, `"fe80::1"`) → bracketed (`"[::1]"`, `"[fe80::1]"`)
 * - Everything else → returned as-is (e.g. `"127.0.0.1"`, `"example.com"`)
 */
export function resolveDisplayHost(hostname: string | undefined): string {
  if (!hostname || hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]") {
    return "localhost";
  }
  if (hostname.includes(":") && !hostname.startsWith("[")) {
    return `[${hostname}]`;
  }
  return hostname;
}
