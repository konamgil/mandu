/**
 * Issue #192 — Hover prefetch helper
 *
 * Self-contained IIFE that watches `mouseover` events bubbling from
 * internal `<a href="/...">` anchors and issues a one-shot
 * `<link rel="prefetch" as="document">` per unique anchor. The browser
 * cache services the subsequent full-reload navigation, so most
 * above-the-fold links feel instantaneous without requiring a SPA
 * runtime.
 *
 * Design choices (locked to keep the payload tiny — target ≤500 bytes
 * minified + gzipped):
 *
 *   1. **WeakSet-based dedup**: we never attach per-anchor listeners;
 *      we use a single `document`-level capture listener and stamp
 *      each anchor we've seen into a `WeakSet`. Anchors removed from
 *      the DOM collect automatically.
 *
 *   2. **Scope: same-origin `/...` paths only**: we deliberately skip
 *      absolute URLs, `mailto:`, `tel:`, `javascript:`, hash-only
 *      fragments, and `#`-on-same-page links. The `a[href^="/"]`
 *      selector implicitly covers this and avoids a surprise
 *      cross-origin DNS lookup.
 *
 *   3. **Opt-out per-link via `data-no-prefetch`**: mirrors Next.js'
 *      `prefetch={false}` ergonomics while being framework-agnostic —
 *      works with plain `<a>` and with Mandu's `<Link>` component.
 *
 *   4. **`as="document"` hint**: the correct token for HTML documents
 *      that will be navigated to via a subsequent click. Without it
 *      Chrome 121+ logs a `rel=prefetch as=missing` warning.
 *
 *   5. **Capture phase + `passive: true`**: listening in the capture
 *      phase catches the event before any app-level bubble handlers
 *      can cancel it (defensive against apps that `stopPropagation`
 *      on `<a>`). `passive` ensures we can never accidentally block
 *      scroll.
 *
 *   6. **Inline, not external bundle**: the helper is under 1KB and
 *      emitting it as a `<script>` child (rather than
 *      `<script src=".../_prefetch.js">`) avoids one HTTP round-trip
 *      on every SSR response and keeps the module graph unchanged.
 *
 * The exported `PREFETCH_HELPER_SCRIPT` wraps the IIFE in a
 * `<script>` tag, ready to paste into `<head>`. Callers MUST keep it
 * nonce-aware if they plan to enable CSP (future work — right now the
 * Fast Refresh preamble is the only inline script covered by Mandu's
 * CSP header).
 */

/** Inner IIFE — exposed for unit tests that want to parse the source. */
export const PREFETCH_HELPER_BODY = `(function(){var s=new WeakSet();document.addEventListener("mouseover",function(e){var t=e.target;if(!t||typeof t.closest!=="function")return;var a=t.closest("a[href^='/']");if(!a||s.has(a))return;if(a.dataset&&a.dataset.noPrefetch!==undefined)return;if(a.hasAttribute&&a.hasAttribute("download"))return;if(a.target&&a.target!=="_self")return;s.add(a);try{var l=document.createElement("link");l.rel="prefetch";l.href=a.href;l.as="document";document.head.appendChild(l);}catch(_){}},{passive:true,capture:true});})();`;

/** Ready-to-inject `<script>` tag for SSR `<head>` injection. */
export const PREFETCH_HELPER_SCRIPT = `<script>${PREFETCH_HELPER_BODY}</script>`;
