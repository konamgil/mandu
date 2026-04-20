/**
 * Phase 18.α — Dev Error Overlay public surface.
 *
 * Consumed by:
 *   - `runtime/ssr.ts` (injects `<style>` + `<script>` into `<head>` in dev)
 *   - `runtime/server.ts` (embeds an SSR 500 payload so the overlay can
 *     mount even when the React tree never rendered)
 *
 * Production never imports from here at runtime — tree-shaking drops
 * the IIFE string because `shouldInjectOverlay` returns `false`.
 */
export {
  buildOverlayHeadTag,
  maybeInjectDevOverlay,
  shouldInjectOverlay,
  parseStackFrames,
  buildPayloadFromError,
  buildOverlayErrorEmbed,
  buildOverlayErrorHtml,
  type DevOverlayInjectorConfig,
} from "./overlay-injector";
export { OVERLAY_CLIENT_SCRIPT } from "./overlay-client";
export { OVERLAY_STYLES } from "./overlay-styles";
export {
  OVERLAY_PAYLOAD_ELEMENT_ID,
  OVERLAY_CUSTOM_EVENT,
  OVERLAY_MOUNTED_FLAG,
  type DevErrorPayload,
  type DevErrorStackFrame,
} from "./types";
