/**
 * HTML 텍스트 콘텐츠 이스케이프
 * <title>, <p> 등 텍스트 노드에 들어갈 문자열을 안전하게 처리.
 * 속성값과 달리 " ' 는 이스케이프 불필요.
 */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * HTML 속성값 이스케이프
 * XSS 방지를 위해 HTML 속성값에 들어갈 문자열을 안전하게 처리
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Inline script의 JSON 데이터 이스케이프
 * <script> 태그 내부의 JSON을 안전하게 처리
 */
export function escapeJsonForInlineScript(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * JavaScript 문자열 리터럴 이스케이프
 * JS 코드 내부의 문자열 보간에 사용
 */
export function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/"/g, "\\u0022")
    .replace(/'/g, "\\u0027")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
