Mandu Kitchen DevTools v0.3.1 (Patch Spec)

v0.3 대비 변경: AI causal context, Plugin render 타입 확정, memory API 호환, preserveLog quota 대응, redact 우선순위 명시, CSS isolation test, Framework↔DevTools Bridge 추가

5. Data Safety / AI Context Spec (v0.3.1 보강)
5.2 AIContextPayload (연쇄 원인/행동 힌트 추가)

변경 의도
단일 에러만 보내면 AI가 “원인-결과 체인”을 못 잡아서 진단 품질이 크게 떨어짐.
단, 행동 로그는 개인정보/입력값 리스크가 있으니 opt-in + 저장/전송 분리가 필요.

interface AIContextPayload {
  // safe 기본 포함
  error: NormalizedError;
  island?: IslandSnapshot;
  framework: { name: 'mandu'; version: string };
  devtools: { version: string };

  // 추가: 최근 연관 에러(최근 N개, dedupe)
  recentErrors?: Array<{
    id: string;
    message: string;
    timestamp: number;
    isCausedBy?: string; // optional causal link
  }>;

  // 추가: 사용자 액션 힌트(옵트인)
  // ⚠️ 절대 사용자 입력값/폼 내용은 넣지 않음
  userActions?: Array<{
    type: 'navigation' | 'interaction' | 'reload';
    targetHint?: string; // e.g. "button#save" (selector hint), no text content
    timestamp: number;
  }>;

  // opt-in 필요
  codeContext?: {
    filePath: string;
    lineRange: [number, number];
    snippet: string; // 필터링된 스니펫
  };
}

권장 기본값(안전한 선)

recentErrors: 5~10개, 동일 message+stackTop은 1개로 dedupe

userActions: 기본 false, 켜더라도 20개 제한, target은 “텍스트/값” 금지(셀렉터 힌트만)

5.3 ContextFilters 실행 순서(우선순위 확정)

정책: Phase 1~2는 비활성화 불가, Phase 3만 opt-in, Phase 4는 항상 마지막

const ContextFilters = {
  // Phase 1: 구조적 제거 (항상 적용)
  removeComments(code: string): string;
  
  // Phase 1b: 문자열 처리 전략 (선택)
  // - 기본은 'smart' 권장: PII/시크릿 패턴만 마스킹하고 의미 있는 문자열은 남김
  // - 'strip'는 강력하지만 진단 품질 하락 가능
  handleStrings(code: string, mode: 'smart'|'strip'): string;

  // Phase 2: 기본 보안 마스킹 (항상 적용, 비활성화 불가)
  redactBuiltInSecrets(text: string): string; // JWT/AWS key/private key blocks etc.

  // Phase 3: 사용자 정의 패턴 (옵트인)
  redactCustomPatterns(text: string, patterns: RegExp[]): string;

  // Phase 4: 용량 제한 (항상 마지막)
  truncate(text: string, maxBytes: number): string;
};

Smart Redaction 기본 제안

이메일/전화/IPv4/IPv6/JWT-like 토큰만 마스킹

문자열 전체 제거는 “옵션(Strip mode)”으로만 제공

6. Fail-safe + Internal Telemetry (v0.3.1 보강)
6.2 memoryUsage 호환성 명시

performance.memory는 Chrome 계열에서만 안정적일 수 있음.
따라서 “있으면 기록, 없으면 undefined”를 문서에 명시.

interface KitchenMetaLog {
  timestamp: number;
  type: 'init' | 'hook_fail' | 'render_fail' | 'bridge_fail' | 'disabled';
  error?: string;
  stack?: string;
  context: {
    eventCount: number;
    activeTab: string;

    // Chrome-only 가능성, 다른 브라우저에서는 undefined
    memoryInfo?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
    };
  };
}

7. Persistence Strategy (Quota & Jank 대응)
7.1 PreserveLogConfig (저장 한계 + 우선순위)

문제: sessionStorage는 보통 5~10MB 제한, beforeunload 직렬화는 jank 유발 가능
해결: “저장량 제한 + 우선순위 + 실패 시 안전 포기”를 스펙으로 못 박음

interface PreserveLogConfig {
  enabled: boolean;

  // 저장 제한(기본)
  maxPersistEvents: number;   // default 50
  maxPersistBytes: number;    // default 2_000_000 (≈2MB)

  // 어떤 걸 먼저 살릴지
  priority: 'errors-first' | 'recent-first';

  // 성능 보호(선택)
  incremental?: {
    enabled: boolean;         // default true
    idleSyncMs: number;       // default 200~500
  };
}

7.2 저장 실패(QuotaExceededError) 처리 규칙

오래된 이벤트부터 제거하면서 재시도

그래도 실패하면 저장 포기하고 메타로그만 남김 (앱 크래시/멈춤 방지)

8. Framework ↔ DevTools 연결 규약 (Instrumentation Bridge) — 신규 핵심

DOM 스캐닝을 기본 경로로 삼지 않으려면, 이 브릿지가 “표준”이어야 함.

8.1 Global Hook Protocol (큐잉 포함)
type ManduDevtoolsHook = {
  emit: (event: KitchenEvent<string, any>) => void;
  onReady: (fn: (push: (e: KitchenEvent<string, any>) => void) => void) => void;
  queue: KitchenEvent<string, any>[];
};

declare global {
  interface Window {
    __MANDU_DEVTOOLS_HOOK__?: ManduDevtoolsHook;
  }
}

동작 규칙

프레임워크 코어는 최초 로드 시 hook을 만들고, DevTools가 없으면 queue에 쌓는다

DevTools가 연결되면 onReady로 handshake → queue flush

production build에서는 이 hook이 noop으로 치환되도록 설계(트리쉐이킹 핵심)

9. Plugin Architecture (render 타입 확정) — v0.3.1
9.1 render() 반환 타입 문제 해결

render(): unknown은 실제로 플러그인 생태계를 못 만든다.
v0.3.1에서는 프레임워크-agnostic(명확) 방식으로 확정한다.

✅ 결론: render(container: HTMLElement): void (imperative mount)

어떤 UI 라이브러리든 가능

Shadow DOM 컨테이너에 마운트하면 CSS 격리와도 자연스럽게 맞음

interface KitchenPanelPlugin {
  id: string;
  name: string;
  order: number;

  init(api: KitchenAPI): void;
  destroy?(): void;

  render(container: HTMLElement): void;
  onEvent?(event: KitchenEvent<string, any>): void;
}

11. Testing Strategy (v0.3.1 보강)
11.3 CSS Isolation Test (Shadow DOM 검증)
test('CSS isolation prevents leakage', async ({ page }) => {
  // 앱 글로벌 오염 CSS
  await page.addStyleTag({ content: '* { color: red !important; }' });

  // DevTools 열기
  await page.keyboard.press('Control+Shift+M');

  // DevTools 영역 텍스트가 빨간색이면 실패
  const el = page.locator('[data-testid="mandu-kitchen-root"]');
  await expect(el).not.toHaveCSS('color', 'rgb(255, 0, 0)');
});