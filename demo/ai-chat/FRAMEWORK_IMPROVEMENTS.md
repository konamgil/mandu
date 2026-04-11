# Mandu Framework Improvement Proposals

ai-chat 데모 개발 과정에서 발견된 프레임워크 개선 제안

**날짜**: 2026-04-11
**기반**: ai-chat 데모 5가지 기능 구현 (Contract, Slot, Multi-island, AI API, Rate Limiting)

---

## 1. Multi-Island 지원 — 한 페이지에 여러 Island

### 현재 제한
- fs-scanner가 같은 디렉토리에서 **첫 번째 `.island.tsx` 파일만** clientModule로 연결
- `app/page.tsx` + `app/chat-app.island.tsx` + `app/sidebar.island.tsx` → sidebar는 무시됨
- 코드: `packages/core/src/router/fs-scanner.ts` line 289: `if (islands?.[0])` — 첫 번째만 사용

### 제안
```typescript
// 현재: 단일 island만 지원
clientModule = islands[0].relativePath;

// 개선: 복수 island 지원
clientModules = islands.map(i => i.relativePath);
```

### 왜 필요한가
- 사이드바 + 메인 콘텐츠를 독립 hydration하면 성능 향상
- 대시보드 페이지에서 각 위젯을 별도 island으로 분리 가능
- Island 아키텍처의 핵심 가치(선택적 hydration)를 완전히 활용하려면 필수

### 구현 방향
1. `FSRouteConfig.clientModule`을 `string | string[]`로 확장
2. SSR 시 각 `data-mandu-island` 래퍼에 island ID 매핑
3. 런타임에서 복수 island 번들을 병렬 로드
4. Island 간 통신: `CustomEvent` 패턴 공식 지원 (이미 작동 확인됨)

---

## 2. Slot → Island 자동 데이터 주입

### 현재 제한
- `spec/slots/index.slot.ts`의 loader 결과가 island의 `serverData`로 자동 전달되는지 불명확
- todo-app은 page.tsx에서 직접 서비스 호출 → `data-props`에 JSON.stringify → island setup에서 파싱
- slot과 island의 데이터 흐름이 문서화되지 않음

### 제안
```typescript
// spec/slots/index.slot.ts
export default Mandu.filling().loader(async () => ({
  sessions: chatService.listSessions(),
  messages: [],
}));

// island에서 자동으로 serverData로 수신
export default island<SlotData>({
  setup: (serverData) => {
    // serverData.sessions 바로 사용 가능
  }
});
```

### 구현 방향
1. slot loader 결과를 `data-mandu-props` 속성으로 자동 직렬화
2. island 런타임이 props를 deserialize하여 `setup(serverData)`에 전달
3. TypeScript 타입 연동: slot의 반환 타입 = island의 serverData 타입

---

## 3. `ctx.input(contract, method)` 공식 패턴 강화

### 현재 상태
- `ctx.input(contract, method)`이 존재하지만 문서/예제가 없음
- 대부분의 데모가 `ctx.body<T>()`를 사용 (타입만 체크, 런타임 검증 없음)
- contract를 정의해도 route에서 수동으로 연결해야 함

### 제안
```typescript
// 자동 연결: contract가 있는 route는 자동으로 input 검증
export default Mandu.filling()
  .contract(chatContract)  // ← 이것만으로 자동 검증
  .post(async (ctx) => {
    // ctx.body가 자동으로 contract 스키마로 검증됨
    // ctx.body의 타입이 contract에서 추론됨
  });
```

### 구현 방향
1. `ManduFilling.contract()` 메서드 추가
2. contract가 설정되면 `onParse` 훅에서 자동 검증
3. 검증 실패 시 400 에러 + Zod 에러 메시지 자동 반환

---

## 4. SSE 에러 이벤트 표준화

### 현재 상태
- SSE 스트리밍 중 에러 발생 시 별도 처리 없음
- AI API 호출 실패 시 클라이언트가 연결 끊김으로만 인식

### 구현된 패턴 (ai-chat에서)
```typescript
// 서버: 에러를 SSE 이벤트로 전송
sse.send({ error: errorMessage }, { event: "error" });

// 클라이언트: error 이벤트 처리
if (data.error) {
  setMessages(prev => prev.map(m => 
    m.id === assistantId ? { ...m, content: `⚠️ ${data.error}` } : m
  ));
}
```

### 제안
- `Mandu.sse()`에 `sse.error(message)` 편의 메서드 추가
- 클라이언트 SDK에 SSE 에러 핸들링 유틸리티 제공

---

## 5. Rate Limiting 미들웨어 내장

### 현재 상태
- rate limiting을 사용하려면 직접 구현해야 함
- `beforeHandle`로 적용 가능하지만 반복 코드 발생

### 구현된 패턴 (ai-chat에서)
```typescript
// src/server/rate-limiter.ts — 슬라이딩 윈도우 구현
const chatRateLimiter = new RateLimiter({ maxRequests: 20, windowMs: 60000 });

// route에서 사용
Mandu.filling()
  .beforeHandle(async (ctx) => {
    const result = chatRateLimiter.check(getClientIp(ctx.request));
    if (!result.allowed) return ctx.json({ error: "Rate limit" }, 429);
  })
```

### 제안
```typescript
// 프레임워크 내장 미들웨어
import { rateLimit } from "@mandujs/core/middleware";

Mandu.filling()
  .use(rateLimit({ max: 20, window: "1m" }))
  .post(async (ctx) => { ... });
```

---

## 6. `dev_start` MCP 반환값 개선 (구현 완료)

### 수정됨
- `{ success: true, pid, port, url }` 반환하도록 패치 적용
- 포트 감지 로직 추가 (stdout 파싱)

---

## 7. Island Hydration Strategy 문서화

### 현재 혼란점
| 패턴 | 파일 위치 | 동작 |
|------|----------|------|
| `app/*.island.tsx` | app/ 디렉토리 | fs-scanner가 자동 감지 |
| `spec/slots/*.client.tsx` | spec/slots/ | auto-linker가 연결 |
| `data-island="name"` | page.tsx HTML | **프레임워크 무관** (사용자 속성) |
| `data-mandu-island="id"` | SSR 출력 | **프레임워크 생성** (hydration 타겟) |

### 제안
- 공식 문서에 "Island 연결 가이드" 추가
- `data-island` 속성을 프레임워크에서 공식 지원하거나, 사용하지 말라는 안내

---

## 8. Windows 개발 경험

### 개선 완료
- `display:contents` 래퍼 적용
- `nul` 경로 필터링
- 좀비 프로세스 `taskkill /T /F`

### 추가 제안
- `mandu dev` 시작 시 이전 좀비 프로세스 자동 감지 + 정리
- `.mandu/dev.pid` 파일로 이전 세션 프로세스 추적

---

## 9. Slot Loader가 Page 렌더링을 깨뜨림 (버그)

### 현상
- `spec/slots/index.slot.ts`에 `Mandu.filling().loader()`를 정의하면 해당 page route가 `404 - Route Not Found`를 반환
- SSR 출력: `<h1>404 - Route Not Found</h1><p>Route ID: index</p>`
- slot 파일을 제거하면 정상 렌더링

### 원인 추정
- slot의 `Mandu.filling()`이 page route의 핸들러를 덮어쓰거나, filling 객체가 page 컴포넌트 대신 route handler로 인식됨
- `(with loader)` 로그가 나오므로 slot 자체는 감지됨

### 영향
- Slot 패턴이 실질적으로 사용 불가 (todo-app에서는 page.tsx 내부에서 직접 서비스 호출하는 방식으로 우회)
- Island의 서버 데이터 주입이 불가능하여 클라이언트에서 fetch해야 함 → 초기 로딩 깜빡임

---

## 10. `display:contents` 래퍼 + `visible` Hydration 전략 충돌 (버그)

### 현상
- Island 래퍼에 `display:contents` 적용 (Issue #3 수정) + 기본 hydration 전략 `visible` (IntersectionObserver) = **hydration 영원히 안 됨**
- `display:contents` 요소는 레이아웃 크기가 0 → IntersectionObserver가 "visible" 감지 불가

### 영향
- 기본 hydration 전략이 `visible`이므로, `display:contents` 수정을 적용하면 **모든 island이 hydrate 안 됨**

### 해결
- `mandu_set_hydration`으로 `priority: "immediate"` 설정하면 동작
- 근본 수정: `display:contents` 적용 시 기본 전략을 `immediate`로 변경하거나, IntersectionObserver 타겟을 래퍼가 아닌 첫 번째 자식 요소로 변경

---

## 우선순위 요약

| 순위 | 개선점 | 영향도 | 난이도 |
|------|--------|--------|--------|
| **1** | Multi-Island 지원 | 높음 | 높음 |
| **2** | Slot → Island 자동 데이터 주입 | 높음 | 중간 |
| **3** | Contract 자동 연결 | 중간 | 낮음 |
| **4** | SSE 에러 표준화 | 중간 | 낮음 |
| **5** | Rate Limiting 내장 | 낮음 | 낮음 |
| **6** | Island 패턴 문서화 | 높음 | 낮음 |
