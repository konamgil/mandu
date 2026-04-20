/**
 * Phase 18.α — Dev Error Overlay: shared type definitions.
 *
 * These types are shipped to both the server-side injector AND the
 * client-side IIFE. Keep them plain-object friendly (no class instances,
 * no bigints) because the payload is round-tripped through
 * `JSON.stringify` when embedded into the 500-response HTML and read back
 * via `JSON.parse(document.getElementById('__MANDU_ERROR__').textContent)`
 * by `overlay-client.ts`.
 */

/**
 * A single formatted stack frame. Parsed from `Error.stack` by the
 * client IIFE; the server also pre-parses when emitting a 500 payload
 * so the overlay can render immediately without running the regex on
 * the main thread twice.
 */
export interface DevErrorStackFrame {
  /** Function name (e.g. `MyComponent`), or `<anonymous>` when the frame is anonymous. */
  fn: string;
  /** Absolute or project-relative file path. Used to build the clickable `vscode://file/` link. */
  file: string;
  /** 1-based line number, or `null` when the stack frame did not carry one. */
  line: number | null;
  /** 1-based column number, or `null`. */
  column: number | null;
  /** The raw frame text as it appeared in `Error.stack` — preserved for copy-paste fidelity. */
  raw: string;
}

/**
 * The structured error payload that both the server (for SSR 500s) and
 * the client (for `window.onerror` / `unhandledrejection`) marshall into
 * the overlay. `kind` distinguishes the entry point so the UI can render
 * a slightly different header ("SSR render failed" vs "Uncaught
 * TypeError") without losing the rest of the data.
 */
export interface DevErrorPayload {
  /** Error class name, e.g. `TypeError`. Falls back to `"Error"` when absent. */
  name: string;
  /** The message. May be empty. */
  message: string;
  /** Parsed frames — first frame is the top of the call stack. */
  frames: DevErrorStackFrame[];
  /** Raw `error.stack` string for "Copy for AI" and fallback rendering. */
  stack: string;
  /** Where the error surfaced. Used for UI copy. */
  kind: "ssr" | "window" | "unhandled-rejection" | "manual";
  /** Unix ms timestamp (client or server clock — both are best-effort in dev). */
  timestamp: number;
  /** Route id, when known (SSR errors carry it; client errors usually don't). */
  routeId?: string;
  /** URL pathname at error time — helpful when copying for AI triage. */
  url?: string;
  /** User-agent, for client-side errors only. The server never fills this. */
  userAgent?: string;
}

/** HTML attribute name the injector uses for the `<script type="application/json">` payload tag. */
export const OVERLAY_PAYLOAD_ELEMENT_ID = "__MANDU_ERROR__";

/** `window` event name fired by user code / server embed to surface an error to the overlay. */
export const OVERLAY_CUSTOM_EVENT = "__MANDU_ERROR__";

/** Sentinel flag on `window` used by the client IIFE to avoid double-mount on HMR. */
export const OVERLAY_MOUNTED_FLAG = "__MANDU_OVERLAY_MOUNTED__";
