# [Issue #81 Support] Demo-first route contract helper proposal

연결 이슈: https://github.com/konamgil/mandu/issues/81

## 배경 (Demo-First 근거)
`mandu-chat-demo` 사용자 시나리오를 먼저 재현/검증한 뒤, 반복 보일러플레이트를 프레임워크 요구사항으로 승격했다.

재현 로그:
- `bun test tests/chat-catchup.test.ts` → 3 pass
- `bun test tests/chat-send-validation.test.ts` → 2 pass

반복 패턴:
1. 쿼리 파라미터 수동 파싱/정규화 반복 (`sinceId`, `limit`)
2. body 파싱/검증 수동 처리 (`text` trim/empty/max length)
3. API 에러 응답 shape/status 수동 합의 (`{ error, code }`)
4. (별도 이슈 #77 연계) SSE route 직렬화/cleanup/ping 보일러플레이트

## 제안 (작고 명확한 범위)
### 1) Typed query/body contract helper
- `querySchema()` : parse/coerce/validate/default/clamp
- `bodySchema()` : JSON parse + typed validate + 표준 에러 변환

### 2) Standard API error helper
- `apiError(code, message, status)`
- 모든 route에서 동일 shape 보장

## Mandu 철학 정합성 점검
- **무결성(Integrity)**: 입력 검증과 오류 응답이 결정론적으로 고정됨
- **아키텍처 일관성**: route 계약 작성 방식이 앱 간 동일해짐
- **재사용 우선**: 반복 parse/validate/error 코드 제거
- **중복 금지**: helper 1곳 유지보수로 route N곳 반영

## 비목표 (무조건 수정 지향 금지)
- 범용 거대 추상화 금지
- 데모에서 재현되지 않은 요구사항 선반영 금지
- 구현 전, 데모 시나리오/검증 로그 없는 변경 금지

## 재현 기준 파일
- `mandu-chat-demo/app/api/chat/messages/route.ts`
- `mandu-chat-demo/app/api/chat/send/route.ts`
- `mandu-chat-demo/app/api/chat/stream/route.ts`
