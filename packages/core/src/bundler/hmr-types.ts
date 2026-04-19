/**
 * Phase 7.0 — Shared HMR types (Vite-compat wire format + `ManduHot` runtime API)
 *
 * This file is the CONTRACT between Agents A (reliability + #188), B
 * (incremental bundled import), and C (Vite-compat `import.meta.hot` +
 * HMR replay + layout-update). Do NOT add logic here — pure types only.
 *
 * Source of truth for:
 *   - `ViteHMRPayload`       — wire format identical to Vite's HMR WebSocket
 *                              payload, so external devtools / IDE extensions
 *                              that speak Vite work against Mandu out of the box.
 *   - `HMREventName`         — Vite built-in event names the client may `on`.
 *   - `ManduHot`             — runtime-side `import.meta.hot` surface (subset).
 *   - `HMRReplayEnvelope`    — server-side queue entry for replay after reconnect.
 *   - `CoalescedChange`      — batched file change handed to the rebuild path.
 *
 * References:
 *   docs/bun/phase-7-team-plan.md §3.1
 *   docs/bun/phase-7-diagnostics/industry-benchmark.md §2 (Vite API spec)
 *   packages/core/src/bundler/dev.ts:453 (pre-existing `HMRMessage` — kept)
 */

// ============================================
// Vite-compat wire format
// ============================================

/**
 * Payload shapes identical to Vite 6 HMR WebSocket wire format.
 *
 * Mandu broadcasts these ALONGSIDE the internal `HMRMessage` shape
 * (dev.ts:453) so a single WS connection serves both:
 *   - Mandu's own client (consumes the richer internal shape)
 *   - External devtools / IDE plugins (consume only Vite-compat events)
 *
 * The payload structure mirrors Vite's to guarantee compatibility. Do NOT
 * reshape for "consistency" with the internal format — the value is that
 * the wire bytes are byte-equivalent to what Vite emits.
 */
export type ViteHMRPayload =
  | { type: "connected" }
  | {
      type: "update";
      updates: Array<{
        type: "js-update" | "css-update";
        path: string;
        acceptedPath: string;
        timestamp: number;
      }>;
    }
  | { type: "full-reload"; path?: string }
  | { type: "prune"; paths: string[] }
  | {
      type: "error";
      err: {
        message: string;
        stack?: string;
        id?: string;
        frame?: string;
        plugin?: string;
        loc?: { file: string; line: number; column: number };
      };
    }
  | { type: "custom"; event: string; data?: unknown };

/**
 * Phase 7.2 — HDR (Hot Data Revalidation) payload.
 *
 * Emitted when a `.slot.ts` file changes. Unlike `full-reload`, the
 * client receives this and re-invokes the route's loader to refetch
 * props while the React tree stays mounted — form input, scroll,
 * focused element all survive. Modeled after Remix's HDR.
 *
 * The client-side handler (runtime/hmr-client.ts `dispatchReplacement`
 * in Phase 7.2) wraps the props update in `React.startTransition` so
 * the browser doesn't flash an intermediate state.
 */
export interface HDRPayload {
  /** Discriminator — NOT a Vite-compat payload (Mandu internal only). */
  type: "slot-refetch";
  /** Route id whose loader must re-invoke. Matches manifest `route.id`. */
  routeId: string;
  /** Absolute path of the slot file that changed — for logging + dedup. */
  slotPath: string;
  /** Monotonic per-server-boot id — compatible with the replay buffer. */
  rebuildId: number;
  /** Unix ms — coalescing window for back-to-back edits. */
  timestamp: number;
}

/**
 * Vite built-in event names a user or plugin may listen for via
 * `import.meta.hot.on()`. Phase 7.0 v0.1 emits the first 4; the rest are
 * Phase 7.1+ additions.
 */
export type HMREventName =
  | "vite:beforeUpdate"
  | "vite:afterUpdate"
  | "vite:beforeFullReload"
  | "vite:error"
  | "vite:beforePrune"         // 7.1
  | "vite:invalidate"          // 7.1
  | "vite:ws:disconnect"       // 7.1
  | "vite:ws:connect";         // 7.1

// ============================================
// Runtime `import.meta.hot` — Mandu subset
// ============================================

/**
 * Runtime surface exposed as `import.meta.hot` in user/framework code.
 *
 * Phase 7.0 v0.1 supports:
 *   - accept (self, self+cb, dep+cb)
 *   - dispose
 *   - data
 *   - invalidate
 *   - on (4 built-in events)
 *
 * Deferred to Phase 7.1+:
 *   - accept([deps], cb)
 *   - prune
 *   - send, off
 *   - custom events
 *   - decline (legacy — we treat it as accept() no-op if anyone calls it)
 *
 * Design constraint: the `import.meta.hot.accept(` string must appear in
 * the user's source verbatim for the bundler to recognize it as an HMR
 * boundary (same static-analysis rule Vite enforces).
 */
export interface ManduHot {
  /**
   * Per-module state preserved across HMR updates. `data` is carried over
   * when a module is hot-replaced; assign fields onto it, don't reassign
   * the object.
   */
  readonly data: Record<string, unknown>;

  /**
   * Self-accept the module. Two overloads:
   *   - `accept()` — no callback. The importer's `accept` runs instead.
   *   - `accept(cb)` — receive the new module namespace.
   */
  accept(cb?: (newModule: unknown) => void): void;

  /**
   * Accept an update to a dependency path. The path must be a string
   * literal at the call site (static analysis requirement).
   */
  accept(dep: string, cb: (newDep: unknown) => void): void;

  /**
   * Register a cleanup to run immediately before this module is replaced.
   * The passed callback receives `data` so you can stash state.
   */
  dispose(cb: (data: Record<string, unknown>) => void): void;

  /**
   * Bail out of the current accept cycle and propagate the update to
   * importers — used when the new module is incompatible with the old
   * one (e.g. breaking API change).
   */
  invalidate(message?: string): void;

  /**
   * Subscribe to Vite-compatible lifecycle events.
   */
  on(event: HMREventName, cb: (payload: unknown) => void): void;
}

/**
 * Per-module HMR context factory — what `createHMRClientScript` (Agent C)
 * returns. The bundler rewrites `import.meta.hot` to a call that returns
 * one of these.
 */
export interface ManduHotContextFactory {
  (moduleUrl: string): ManduHot;
}

// ============================================
// Replay (B8)
// ============================================

/**
 * A broadcast envelope kept in the server's replay buffer. When a client
 * reconnects with `?since=<id>` on the WS URL, the server re-sends every
 * envelope with `id > since` so nothing is lost across short dropouts.
 *
 * The buffer is a bounded ring — `MAX_REPLAY_BUFFER` entries. Anything
 * older is dropped, and reconnecting clients with a too-old `since` are
 * forced to a `full-reload` (the safe fallback).
 */
export interface HMRReplayEnvelope {
  /** Monotonically increasing per-server-boot. Resets to 0 on restart. */
  id: number;
  /** Unix ms when broadcast was queued. */
  timestamp: number;
  /** The payload that was / will be sent. */
  payload: ViteHMRPayload;
}

/** Bounded buffer size. Anything older than this is pruned. */
export const MAX_REPLAY_BUFFER = 128;

/** "Missed too much — full reload" threshold in ms. */
export const REPLAY_MAX_AGE_MS = 60_000;

// ============================================
// Coalesced file change (B2 + B6)
// ============================================

/**
 * A batched change produced by Agent A's per-file debounce + Set-based
 * `pendingBuildSet`. The rebuild path consumes one of these per tick, not
 * one per raw fs event — this is the fix for B2 (single-slot drop) and B6
 * (global single timer).
 *
 * `kind` categorizes the changes so the rebuild path can short-circuit
 * ("mixed" → fall through to common-dir rebuild; "islands-only" → skip
 * framework bundles).
 */
export interface CoalescedChange {
  /** Absolute, normalized paths. No duplicates. */
  files: readonly string[];
  /** Earliest raw fs event timestamp (Date.now()). */
  firstSeenAt: number;
  /** Latest raw fs event timestamp. */
  lastSeenAt: number;
  /**
   * Categorical summary derived from path classification. Pre-computed so
   * the rebuild path doesn't re-scan the file list.
   */
  kind:
    | "islands-only"            // *.client.tsx / *.island.tsx only
    | "ssr-only"                // page.tsx / layout.tsx / slot.ts only
    | "common-dir"              // src/** changes (may fan out to any route)
    | "css-only"                // *.css only
    | "api-only"                // route.ts (API)
    | "config-reload"           // mandu.config.ts / .env — server restart
    | "resource-regen"          // *.resource.ts / *.contract.ts — code-gen
    | "mixed";                  // more than one category
}

// ============================================
// Scenario matrix re-export for cross-module use
// ============================================

/**
 * Re-exported so consumers can `import { ... } from "../bundler/hmr-types"`
 * without a second import line. The canonical definitions live in
 * `./scenario-matrix.ts` to keep this file logic-free.
 */
export type { ProjectForm, ChangeKind, ScenarioCell } from "./scenario-matrix";
