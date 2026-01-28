# Mandu API 레퍼런스

Mandu 핵심 API의 간단한 레퍼런스입니다.

---

## Mandu.filling()

### HTTP 메서드

| 메서드 | 설명 |
|--------|------|
| `.get(handler)` | GET 처리 |
| `.post(handler)` | POST 처리 |
| `.put(handler)` | PUT 처리 |
| `.patch(handler)` | PATCH 처리 |
| `.delete(handler)` | DELETE 처리 |
| `.head(handler)` | HEAD 처리 |
| `.options(handler)` | OPTIONS 처리 |
| `.all(handler)` | 모든 메서드 처리 |

### 라이프사이클 훅

| 메서드 | 설명 |
|--------|------|
| `.onRequest(fn)` | 요청 시작 시 실행 |
| `.onParse(fn)` | 바디 메서드에서 핸들러 전 실행 |
| `.beforeHandle(fn)` | 가드 훅 (Response 반환 시 차단) |
| `.afterHandle(fn)` | 핸들러 후 실행 |
| `.mapResponse(fn)` | 최종 응답 매핑 |
| `.afterResponse(fn)` | 응답 후 실행 (비동기) |
| `.onError(fn)` | 에러 훅 (Response 반환 시 처리) |

### 가드 별칭

| 메서드 | 설명 |
|--------|------|
| `.guard(fn)` | `beforeHandle` 별칭 |
| `.use(fn)` | `guard` 별칭 |

### Compose 스타일 미들웨어

| 메서드 | 설명 |
|--------|------|
| `.middleware(fn, name?)` | Koa/Hono 스타일 미들웨어 체인 |

**미들웨어 시그니처:**

```ts
type Middleware = (ctx: ManduContext, next: () => Promise<void>) =>
  Response | void | Promise<Response | void>;
```

### Loader (SSR)

| 메서드 | 설명 |
|--------|------|
| `.loader(fn)` | 페이지 라우트용 SSR loader 등록 |

### 실행

| 메서드 | 설명 |
|--------|------|
| `.handle(request, params?, routeContext?, options?)` | 라이프사이클 + 핸들러 실행 |

---

## ManduContext

### 요청 정보

| 프로퍼티 | 설명 |
|----------|------|
| `ctx.req` | Request 객체 |
| `ctx.method` | HTTP 메서드 |
| `ctx.url` | 요청 URL |
| `ctx.params` | 라우트 파라미터 |
| `ctx.query` | 쿼리 스트링 |
| `ctx.headers` | 요청 헤더 |
| `ctx.cookies` | 쿠키 매니저 |

### Body

| 메서드 | 설명 |
|--------|------|
| `ctx.body<T>(schema?)` | 요청 본문 파싱 (선택: Zod 검증) |

> `onParse`에서 body를 읽을 때는 `ctx.req.clone()` 사용 권장.

### 응답

| 메서드 | 설명 |
|--------|------|
| `ctx.ok(data)` | 200 OK |
| `ctx.created(data)` | 201 Created |
| `ctx.noContent()` | 204 No Content |
| `ctx.error(message, details?)` | 400 Bad Request |
| `ctx.unauthorized(message?)` | 401 Unauthorized |
| `ctx.forbidden(message?)` | 403 Forbidden |
| `ctx.notFound(message?)` | 404 Not Found |
| `ctx.fail(message?)` | 500 Internal Server Error |
| `ctx.json(data, status?)` | JSON 응답 |
| `ctx.text(data, status?)` | 텍스트 응답 |
| `ctx.html(data, status?)` | HTML 응답 |
| `ctx.redirect(url, status?)` | 리다이렉트 |

### Store

| 메서드 | 설명 |
|--------|------|
| `ctx.set(key, value)` | 데이터 저장 |
| `ctx.get<T>(key)` | 데이터 조회 |
| `ctx.has(key)` | 존재 여부 확인 |

---

## Trace

| API | 설명 |
|-----|------|
| `enableTrace(ctx)` | 트레이스 활성화 |
| `getTrace(ctx)` | 원본 트레이스 데이터 조회 |
| `buildTraceReport(trace)` | 표준 리포트 생성 |
| `formatTraceReport(report)` | JSON 출력 |
| `TRACE_KEY` | ctx store 키 |

---

## 직렬화 (Islands)

| API | 설명 |
|-----|------|
| `serializeProps(props)` | 고급 타입 직렬화 |
| `deserializeProps(json)` | 역직렬화 |
| `isSerializable(value)` | 직렬화 가능 여부 |
| `generatePropsScript(id, props)` | SSR 스크립트 생성 |
| `parsePropsScript(id)` | 클라이언트 파싱 |

---

## 에러

| 에러 | 설명 |
|------|------|
| `ValidationError` | 스키마 검증 에러 |
| `AuthenticationError` | 인증 필요 |
| `AuthorizationError` | 권한 없음 |
