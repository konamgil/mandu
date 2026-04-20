/**
 * Phase 18.α — Dev Error Overlay styles.
 *
 * Scoped CSS string emitted inside a single `<style>` tag by the
 * injector. Deliberately:
 *
 *   - Prefix every selector with `.mandu-dev-overlay` so we never leak
 *     into the host page's stylesheet (no `*` or `body` selectors).
 *   - Inline all values — no Tailwind, no CSS vars from userland.
 *   - Use `system-ui, -apple-system, ...` + a monospace stack so the
 *     overlay works even on pages that have not yet loaded webfonts
 *     (broken SSR responses often haven't).
 *   - Hit contrast ratio ≥ 7:1 (WCAG AAA) for the text-on-backdrop
 *     combination: `#f4f4f5` on `rgba(10,10,10,0.94)` ≈ 14.2:1.
 *
 * The whole string weighs ~2.2 KB uncompressed. gzip ≈ 0.9 KB.
 */
export const OVERLAY_STYLES = `
.mandu-dev-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(10,10,10,0.94);color:#f4f4f5;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:13px;line-height:1.5;overflow:auto;padding:32px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.mandu-dev-overlay *,.mandu-dev-overlay *::before,.mandu-dev-overlay *::after{box-sizing:border-box}
.mandu-dev-overlay__panel{max-width:960px;margin:0 auto;background:#18181b;border:1px solid #3f3f46;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,0.6);overflow:hidden}
.mandu-dev-overlay__header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#27272a;border-bottom:1px solid #3f3f46}
.mandu-dev-overlay__title{display:flex;flex-direction:column;gap:4px}
.mandu-dev-overlay__kind{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#fca5a5;font-weight:600}
.mandu-dev-overlay__name{font-size:18px;color:#fafafa;font-weight:600;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.mandu-dev-overlay__actions{display:flex;gap:8px}
.mandu-dev-overlay__btn{appearance:none;background:#3f3f46;border:1px solid #52525b;color:#fafafa;padding:6px 12px;border-radius:6px;font-family:inherit;font-size:12px;cursor:pointer;transition:background 120ms ease;font-weight:500}
.mandu-dev-overlay__btn:hover{background:#52525b}
.mandu-dev-overlay__btn:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
.mandu-dev-overlay__btn--primary{background:#2563eb;border-color:#1d4ed8}
.mandu-dev-overlay__btn--primary:hover{background:#1d4ed8}
.mandu-dev-overlay__body{padding:24px}
.mandu-dev-overlay__message{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;color:#fafafa;margin:0 0 20px;white-space:pre-wrap;word-break:break-word;padding:12px 16px;background:#0a0a0a;border-left:3px solid #ef4444;border-radius:4px}
.mandu-dev-overlay__meta{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:20px;padding:12px 16px;background:#0a0a0a;border-radius:6px;font-size:12px}
.mandu-dev-overlay__meta-item{display:flex;flex-direction:column;gap:2px}
.mandu-dev-overlay__meta-label{color:#a1a1aa;font-size:10px;text-transform:uppercase;letter-spacing:0.06em}
.mandu-dev-overlay__meta-value{color:#e4e4e7}
.mandu-dev-overlay__section-title{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#a1a1aa;margin:0 0 8px;font-weight:600}
.mandu-dev-overlay__frames{list-style:none;margin:0;padding:0;background:#0a0a0a;border-radius:6px;overflow:hidden}
.mandu-dev-overlay__frame{padding:10px 16px;border-bottom:1px solid #27272a;display:flex;flex-direction:column;gap:2px}
.mandu-dev-overlay__frame:last-child{border-bottom:none}
.mandu-dev-overlay__frame-fn{color:#fbbf24;font-weight:500}
.mandu-dev-overlay__frame-loc{color:#a1a1aa;font-size:12px}
.mandu-dev-overlay__frame-link{color:#93c5fd;text-decoration:none;cursor:pointer}
.mandu-dev-overlay__frame-link:hover{text-decoration:underline;color:#bfdbfe}
.mandu-dev-overlay__frame-link:focus-visible{outline:2px solid #60a5fa;outline-offset:1px;border-radius:2px}
.mandu-dev-overlay__stack{margin-top:16px;padding:12px 16px;background:#0a0a0a;border-radius:6px;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#d4d4d8;font-size:12px}
.mandu-dev-overlay__footer{padding:12px 24px;background:#0a0a0a;border-top:1px solid #27272a;font-size:11px;color:#71717a;text-align:center}
.mandu-dev-overlay__footer code{background:#27272a;padding:1px 6px;border-radius:3px;color:#a1a1aa}
.mandu-dev-overlay[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.mandu-dev-overlay__btn{transition:none}}
`.trim();
