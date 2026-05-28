/**
 * Mandu props serialization public API.
 *
 * Core serialization/deserialization lives in `props-serialization.ts` so the
 * browser runtime and server render path share exactly one wire format.
 */

import { deserializeProps, serializeProps } from "./props-serialization";

export {
  deserializeProps,
  isSerializable,
  serializeProps,
} from "./props-serialization";

/**
 * SSR에서 클라이언트로 props 전달용 스크립트 생성
 */
export function generatePropsScript(
  islandId: string,
  props: Record<string, unknown>
): string {
  const json = serializeProps(props);
  const escaped = json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<script type="application/json" data-mandu-props="${islandId}">${escaped}</script>`;
}

/**
 * 클라이언트에서 props 스크립트 파싱
 */
export function parsePropsScript(islandId: string): Record<string, unknown> | null {
  if (typeof document === "undefined") return null;

  const script = document.querySelector(
    `script[data-mandu-props="${islandId}"]`
  ) as HTMLScriptElement | null;

  if (!script?.textContent) return null;

  try {
    return deserializeProps(script.textContent);
  } catch (err) {
    console.error(`[Mandu] Failed to parse props for island ${islandId}:`, err);
    return null;
  }
}
