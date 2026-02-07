---
title: Secure Environment Variable Management
impact: HIGH
impactDescription: Prevents secret exposure
tags: security, env, secrets, configuration
---

## Secure Environment Variable Management

**Impact: HIGH (Prevents secret exposure)**

시크릿과 민감한 설정은 환경 변수로 관리하고, 절대 코드에 하드코딩하지 마세요.

**Vulnerable (하드코딩된 시크릿):**

```typescript
// ❌ 코드에 시크릿 하드코딩
const db = new Database({
  host: "prod-db.example.com",
  password: "super_secret_password",  // 위험!
});

const stripe = new Stripe("sk_live_abc123xyz");  // 위험!
```

**Secure (환경 변수 사용):**

```typescript
// ✅ 환경 변수에서 로드
const db = new Database({
  host: process.env.DATABASE_HOST,
  password: process.env.DATABASE_PASSWORD,
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

## 환경 변수 검증

```typescript
// lib/env.ts
import { z } from "zod";

const envSchema = z.object({
  // 필수
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),

  // 선택 (기본값)
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),

  // 프로덕션에서만 필수
  SENTRY_DSN: z.string().url().optional(),
});

// 앱 시작 시 검증
export const env = envSchema.parse(process.env);

// 타입 안전한 접근
console.log(env.DATABASE_URL);  // string
console.log(env.PORT);          // number
```

## .env 파일 관리

```bash
# .env.example (커밋됨 - 템플릿)
DATABASE_URL=postgresql://user:password@localhost:5432/db
SESSION_SECRET=change_me_to_random_32_char_string
STRIPE_SECRET_KEY=sk_test_xxx

# .env.local (커밋 안 됨 - 실제 값)
DATABASE_URL=postgresql://admin:real_password@prod-db:5432/myapp
SESSION_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
STRIPE_SECRET_KEY=sk_live_real_key_here
```

## .gitignore 설정

```gitignore
# 환경 변수 파일
.env
.env.local
.env.*.local

# 시크릿 관련
*.pem
*.key
credentials.json
```

## 클라이언트에 노출되지 않도록 주의

```typescript
// ❌ 클라이언트 번들에 포함됨
// app/page.tsx
const apiKey = process.env.API_SECRET_KEY;  // 위험!

// ✅ 서버에서만 사용
// spec/slots/api.slot.ts
export default Mandu.filling()
  .get(async (ctx) => {
    // 서버 측에서만 접근
    const apiKey = process.env.API_SECRET_KEY;
    const data = await fetchExternalApi(apiKey);
    return ctx.ok({ data });  // apiKey는 반환하지 않음
  });
```

## 시크릿 로테이션

```typescript
// 여러 버전의 시크릿 지원
const CURRENT_SECRET = process.env.SESSION_SECRET!;
const PREVIOUS_SECRET = process.env.SESSION_SECRET_PREVIOUS;

function verifyToken(token: string): boolean {
  // 현재 시크릿으로 먼저 검증
  if (verify(token, CURRENT_SECRET)) return true;

  // 이전 시크릿으로도 검증 (로테이션 기간)
  if (PREVIOUS_SECRET && verify(token, PREVIOUS_SECRET)) {
    // 토큰 갱신 권장
    return true;
  }

  return false;
}
```

Reference: [12-Factor App Config](https://12factor.net/config)
