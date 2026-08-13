---
title: Implement CSRF Protection
impact: HIGH
impactDescription: Prevents cross-site request forgery
tags: security, csrf, protection, token
---

## Implement CSRF Protection

**Impact: HIGH (Prevents cross-site request forgery)**

상태를 변경하는 요청(POST, PUT, DELETE)에 CSRF 토큰을 적용하세요.

**Vulnerable (CSRF 보호 없음):**

```typescript
// ❌ CSRF 토큰 없이 상태 변경
export default Mandu.filling()
  .post(async (ctx) => {
    // 악의적인 사이트에서 이 요청을 보낼 수 있음
    await db.user.delete({
      where: { id: ctx.get("user").id },
    });
    return ctx.ok({ message: "Account deleted" });
  });
```

**Secure (CSRF 토큰 검증):**

```typescript
import { verifyCsrfToken } from "@/lib/csrf";

export default Mandu.filling()
  .guard((ctx) => {
    const user = ctx.get("user");
    if (!user) return ctx.unauthorized();

    // CSRF 토큰 검증
    const token = ctx.headers.get("x-csrf-token");
    if (!verifyCsrfToken(token, user.sessionId)) {
      return ctx.forbidden("Invalid CSRF token");
    }
  })
  .post(async (ctx) => {
    await db.user.delete({
      where: { id: ctx.get("user").id },
    });
    return ctx.ok({ message: "Account deleted" });
  });
```

## CSRF 토큰 생성

```typescript
// lib/csrf.ts
import { createHmac, randomBytes } from "crypto";

const SECRET = process.env.CSRF_SECRET!;

export function generateCsrfToken(sessionId: string): string {
  const timestamp = Date.now().toString();
  const random = randomBytes(16).toString("hex");
  const data = `${sessionId}:${timestamp}:${random}`;

  const signature = createHmac("sha256", SECRET)
    .update(data)
    .digest("hex");

  return `${data}:${signature}`;
}

export function verifyCsrfToken(token: string | null, sessionId: string): boolean {
  if (!token) return false;

  const parts = token.split(":");
  if (parts.length !== 4) return false;

  const [tokenSessionId, timestamp, random, signature] = parts;

  // 세션 ID 확인
  if (tokenSessionId !== sessionId) return false;

  // 만료 확인 (1시간)
  const tokenTime = parseInt(timestamp, 10);
  if (Date.now() - tokenTime > 3600000) return false;

  // 서명 확인
  const data = `${tokenSessionId}:${timestamp}:${random}`;
  const expectedSignature = createHmac("sha256", SECRET)
    .update(data)
    .digest("hex");

  return signature === expectedSignature;
}
```

## 클라이언트에서 CSRF 토큰 전송

```tsx
// Island에서 CSRF 토큰 사용
"use client";

export function DeleteAccountButton({ csrfToken }: { csrfToken: string }) {
  const handleDelete = async () => {
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,  // CSRF 토큰 포함
      },
    });

    if (res.ok) {
      window.location.href = "/goodbye";
    }
  };

  return <button onClick={handleDelete}>Delete Account</button>;
}
```

## SameSite 쿠키와 함께 사용

```typescript
// 세션 쿠키 설정
ctx.cookie("session", sessionId, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",  // 또는 "strict"
  maxAge: 86400,
});
```

## 추가 방어 (Double Submit)

```typescript
// 쿠키와 헤더 모두에서 토큰 확인
const cookieToken = ctx.cookies.get("csrf");
const headerToken = ctx.headers.get("x-csrf-token");

if (!cookieToken || cookieToken !== headerToken) {
  return ctx.forbidden("CSRF validation failed");
}
```

Reference: [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
