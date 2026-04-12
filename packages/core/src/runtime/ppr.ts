/**
 * Mandu Partial Prerendering (PPR)
 *
 * Caches the static HTML shell (header, sidebar, layout) at build/first-request time,
 * then injects fresh dynamic data (loader results) per request.
 *
 * Result: TTFB of a static page + freshness of a dynamic page.
 *
 * The shell is the expensive part (React render tree traversal).
 * Data injection is cheap (JSON serialization into a script tag).
 */

import { escapeJsonForInlineScript } from "./escape";
import { serializeProps } from "../client/serialize";

/**
 * PPR shell marker injected at the end of cached HTML.
 * Everything before this marker is the static shell; everything after
 * (closing tags, data scripts) is regenerated per request.
 */
export const PPR_SHELL_MARKER = "<!--mandu:ppr-split-->";

/**
 * Strip the closing </body></html> and any trailing whitespace from
 * a full SSR HTML string, then append the shell marker.
 * The result is safe to cache and later concatenated with fresh data.
 */
export function extractShellHtml(fullHtml: string): string {
  // Remove trailing </body></html> (case-insensitive, whitespace-tolerant)
  const trimmed = fullHtml.replace(/<\/body>\s*<\/html>\s*$/i, "");
  return trimmed + PPR_SHELL_MARKER;
}

/**
 * Build a streaming Response that:
 *   1. Sends the cached shell immediately (near-zero TTFB)
 *   2. Appends a script tag with fresh loader data
 *   3. Closes with </body></html>
 */
export function createPPRResponse(
  shellHtml: string,
  routeId: string,
  loaderData: unknown,
): Response {
  const encoder = new TextEncoder();

  // Build the data payload once; avoid doing work inside the stream callback
  const serialized = serializeProps({ serverData: loaderData });
  const escaped = escapeJsonForInlineScript(serialized);
  const dataScript =
    `<script>window.__MANDU_DATA__=window.__MANDU_DATA__||{};` +
    `window.__MANDU_DATA__[${JSON.stringify(routeId)}]=${escaped}</script>`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // (a) Cached shell -- everything up to the split marker (inclusive)
      controller.enqueue(encoder.encode(shellHtml));
      // (b) Fresh data script
      controller.enqueue(encoder.encode(dataScript));
      // (c) Close the document
      controller.enqueue(encoder.encode("</body></html>"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Mandu-PPR": "shell-hit",
    },
  });
}
