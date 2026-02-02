---
title: Optimize Bun.serve() Configuration
impact: HIGH
impactDescription: 2-5× faster than Node.js http
tags: performance, bun, serve, runtime
---

## Optimize Bun.serve() Configuration

**Impact: HIGH (2-5× faster than Node.js http)**

Mandu는 Bun.serve()를 기반으로 합니다. 적절한 설정으로 최대 성능을 끌어내세요.

**기본 최적화 설정:**

```typescript
// server.ts
Bun.serve({
  port: 3000,

  // ✅ 개발 환경에서만 에러 스택 노출
  development: process.env.NODE_ENV !== "production",

  // ✅ 정적 파일 직접 서빙 (미들웨어 우회)
  static: {
    "/public/*": "./public/",
  },

  fetch(req) {
    // Mandu 라우터 처리
    return handleRequest(req);
  },

  // ✅ 에러 핸들링
  error(error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  },
});
```

## 정적 파일 최적화

```typescript
Bun.serve({
  fetch(req) {
    const url = new URL(req.url);

    // ✅ 정적 파일은 Bun.file()로 직접 서빙
    if (url.pathname.startsWith("/assets/")) {
      const filePath = `./public${url.pathname}`;
      const file = Bun.file(filePath);

      return new Response(file, {
        headers: {
          // 캐시 헤더 설정
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    return handleRequest(req);
  },
});
```

## 스트리밍 응답

대용량 데이터는 스트리밍으로 메모리 효율 향상:

```typescript
export default Mandu.filling()
  .get(async (ctx) => {
    // ✅ 스트리밍 응답
    const stream = new ReadableStream({
      async start(controller) {
        const cursor = db.query("SELECT * FROM large_table");

        for await (const row of cursor) {
          controller.enqueue(JSON.stringify(row) + "\n");
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  });
```

## TLS 설정 (HTTPS)

```typescript
Bun.serve({
  port: 443,

  // ✅ TLS 인증서 설정
  tls: {
    cert: Bun.file("./cert.pem"),
    key: Bun.file("./key.pem"),
  },

  fetch(req) {
    return handleRequest(req);
  },
});
```

## 동시 연결 처리

Bun은 기본적으로 높은 동시성을 지원하지만, 리소스 제한이 있는 환경에서는:

```typescript
Bun.serve({
  // ✅ 최대 동시 연결 제한 (메모리 보호)
  maxRequestBodySize: 1024 * 1024 * 10, // 10MB

  fetch(req) {
    return handleRequest(req);
  },
});
```

Reference: [Bun.serve() documentation](https://bun.sh/docs/api/http)
