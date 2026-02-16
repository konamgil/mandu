/**
 * Runtime Shims for React Compatibility
 *
 * React 19+ 호환성을 위한 런타임 shim 스크립트들을 제공합니다.
 *
 * @module runtime/shims
 */

/**
 * React 19 Client Internals Shim Script
 *
 * React 19에서 react-dom/client가 실행되기 전에 ReactSharedInternals.S가
 * 존재하는지 확인하고 필요시 초기화하는 inline 스크립트입니다.
 *
 * **사용 목적**:
 * - Playwright headless 환경에서 hydration 실패 방지
 * - React 19의 __CLIENT_INTERNALS.S가 null일 수 있는 문제 해결
 * - SSR HTML에 삽입하여 번들 로드 전에 실행
 *
 * **안전성**:
 * - try-catch로 감싸져 있어 오류 발생 시에도 안전
 * - 기존 값이 있으면 덮어쓰지 않음
 * - React가 없거나 internals가 없어도 실패하지 않음
 *
 * @example
 * ```typescript
 * // SSR HTML에 삽입
 * const html = `
 *   ${hydrationScripts}
 *   ${REACT_INTERNALS_SHIM_SCRIPT}
 *   ${routerScript}
 * `;
 * ```
 */
export const REACT_INTERNALS_SHIM_SCRIPT = `<script>
// React 19 internals shim: ensure ReactSharedInternals.S exists before react-dom/client runs.
// Some builds expect React.__CLIENT_INTERNALS... .S to be a function, but it may be null.
// This shim is safe: it only fills the slot if missing.
(function(){
  try {
    var React = window.React;
    var i = React && React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    if (i && i.S == null) {
      i.S = function(){};
    }
  } catch(e) {}
})();
</script>`;
