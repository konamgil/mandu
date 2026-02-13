# [Draft Issue] feat(core): add typed request parsing + SSE helper for API routes

## 제목 제안
`feat(core): typed query/body parser and SSE responder utilities for app/api routes`

## 배경 (Demo-First 근거)
`mandu-chat-demo` 고도화 중 아래 반복 패턴이 확인됨.

1. 쿼리 파라미터 수동 파싱/정규화 반복
   - 예: `sinceId`, `limit`를 route마다 수동 처리
2. SSE 스트림 구성 보일러플레이트 반복
   - `event/data` 직렬화, ping, abort/cleanup 처리 재구현
3. 에러 응답 계약 수동 합의
   - `{ error, code }` 형태를 route마다 직접 정의

## 제안

### 1) typed request parser helper
- `parseQuery(request, schema)`
- `parseJsonBody(request, schema)`
- zod(or lightweight schema) 기반 파싱 + 기본 에러 응답 통합

### 2) SSE responder helper
- `createSseResponse({ onConnect, pingIntervalMs })`
- `send(event, payload)`
- 자동 abort cleanup + 안전 enqueue

### 3) error response helper
- `apiError(code, message, status)`
- 일관된 JSON shape 보장

## 기대 효과
- 데모/실서비스 route 코드량 감소
- 파라미터/에러 계약 일관성 향상
- SSE 기능 구현 난이도 하락

## 재현 기준 (demo)
- `mandu-chat-demo/app/api/chat/messages/route.ts`
- `mandu-chat-demo/app/api/chat/send/route.ts`
- `mandu-chat-demo/app/api/chat/stream/route.ts`

위 3개 파일에서 현재 반복되는 보일러플레이트를 helper로 치환 가능한지 PoC 검증 가능.
