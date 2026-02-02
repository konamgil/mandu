---
title: Configure Security Headers
impact: HIGH
impactDescription: Enables browser security features
tags: security, headers, csp, hsts
---

## Configure Security Headers

**Impact: HIGH (Enables browser security features)**

보안 헤더를 설정하여 브라우저의 보안 기능을 활성화하세요.

**기본 보안 헤더 설정:**

```typescript
// middleware/security.ts
export function securityHeaders(ctx: Context) {
  // XSS 필터 활성화
  ctx.header("X-XSS-Protection", "1; mode=block");

  // MIME 타입 스니핑 방지
  ctx.header("X-Content-Type-Options", "nosniff");

  // Clickjacking 방지
  ctx.header("X-Frame-Options", "DENY");

  // Referrer 정보 제한
  ctx.header("Referrer-Policy", "strict-origin-when-cross-origin");

  // HTTPS 강제 (프로덕션)
  if (process.env.NODE_ENV === "production") {
    ctx.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}
```

## Content Security Policy (CSP)

```typescript
// 엄격한 CSP 설정
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",  // Island hydration 필요
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://api.example.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

ctx.header("Content-Security-Policy", csp);
```

## Nonce 기반 CSP (더 안전)

```typescript
// 요청마다 새 nonce 생성
import { randomBytes } from "crypto";

export function createCspNonce(): string {
  return randomBytes(16).toString("base64");
}

// 미들웨어에서 설정
const nonce = createCspNonce();
ctx.set("cspNonce", nonce);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}'`,  // nonce가 있는 스크립트만 허용
  "style-src 'self' 'unsafe-inline'",
  // ...
].join("; ");

ctx.header("Content-Security-Policy", csp);
```

```html
<!-- HTML에서 nonce 사용 -->
<script nonce="${nonce}">
  // 이 스크립트만 실행됨
</script>
```

## Permissions Policy

```typescript
// 브라우저 기능 제한
const permissions = [
  "camera=()",           // 카메라 비활성화
  "microphone=()",       // 마이크 비활성화
  "geolocation=(self)",  // 지오로케이션은 자체 도메인만
  "payment=(self)",      // 결제는 자체 도메인만
].join(", ");

ctx.header("Permissions-Policy", permissions);
```

## 전체 보안 헤더 미들웨어

```typescript
// middleware/security.ts
export function applySecurityHeaders(ctx: Context) {
  const headers = {
    "X-XSS-Protection": "1; mode=block",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  };

  // 프로덕션 전용
  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
    headers["Content-Security-Policy"] = buildCsp();
  }

  Object.entries(headers).forEach(([key, value]) => {
    ctx.header(key, value);
  });
}
```

## 검증 도구

```bash
# 헤더 확인
curl -I https://your-site.com

# 보안 헤더 스캔
# https://securityheaders.com
# https://observatory.mozilla.org
```

Reference: [OWASP Secure Headers](https://owasp.org/www-project-secure-headers/)
