/**
 * Home route slot — Phase 7.3 HDR E2E fixture.
 *
 * This file exists primarily to register `route.slotModule` for the
 * `/` route in the generated manifest (see
 * `packages/core/src/router/fs-routes.ts` `resolveAutoLinks` — it scans
 * `spec/slots/{routeId}.slot.ts` and promotes the page route's
 * server-bundler to HDR mode when the file is present).
 *
 * The actual loader runs in `app/page.tsx` via the page module's
 * `export const filling` — that's the page-level convention. When this
 * file is edited in `mandu dev`, the CLI broadcasts
 * `mandu:slot-refetch` over the HMR websocket; the client re-fetches
 * `?_data=1` with `X-Mandu-HDR: 1`; React state survives.
 *
 * The exported `HOME_SLOT_MARKER` serves two purposes:
 *   1. Any trivial top-level expression makes the file non-empty so
 *      Bun's file watcher + module graph treat mutations as real
 *      source changes (some watchers coalesce whitespace-only edits).
 *   2. The value can be bumped by the Playwright test harness when it
 *      wants a deterministic, observable change — every mutation
 *      rewrites this constant to a fresh Date.now() string.
 */
import { Mandu } from "@mandujs/core";

export const HOME_SLOT_MARKER = "initial";

// Keep the file a valid slot as well as the HDR change signal. The page owns
// its loader; this empty filling only satisfies the slot boundary contract.
export default Mandu.filling();
