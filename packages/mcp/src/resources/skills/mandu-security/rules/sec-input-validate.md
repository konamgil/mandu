---
title: Always Validate and Sanitize Input
impact: CRITICAL
impactDescription: Prevents injection attacks
tags: security, input, validation, sanitize
---

## Always Validate and Sanitize Input

**Impact: CRITICAL (Prevents injection attacks)**

모든 사용자 입력을 서버에서 검증하고 살균하세요. 클라이언트 검증은 우회될 수 있습니다.

**Vulnerable (검증 없음):**

```typescript
// ❌ 입력 검증 없이 직접 사용
export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body();

    // SQL Injection 취약
    const user = await db.$queryRaw`
      SELECT * FROM users WHERE email = '${body.email}'
    `;

    return ctx.ok({ user });
  });
```

**Secure (Zod로 검증):**

```typescript
import { z } from "zod";

// ✅ 스키마 정의
const createUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150).optional(),
});

export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body();

    // 스키마로 검증
    const result = createUserSchema.safeParse(body);

    if (!result.success) {
      return ctx.error({
        message: "Validation failed",
        errors: result.error.flatten(),
      });
    }

    // 검증된 데이터 사용 (Parameterized query)
    const user = await db.user.create({
      data: result.data,
    });

    return ctx.created({ user });
  });
```

## 입력 유형별 검증

```typescript
const schema = z.object({
  // 문자열
  username: z.string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/),  // 알파벳, 숫자, 언더스코어만

  // 이메일
  email: z.string().email(),

  // URL
  website: z.string().url().optional(),

  // 숫자
  age: z.number().int().positive().max(150),

  // Enum
  role: z.enum(["user", "admin", "moderator"]),

  // 배열
  tags: z.array(z.string().max(50)).max(10),

  // 중첩 객체
  address: z.object({
    street: z.string().max(200),
    city: z.string().max(100),
  }).optional(),
});
```

## 파일 업로드 검증

```typescript
export default Mandu.filling()
  .post(async (ctx) => {
    const formData = await ctx.req.formData();
    const file = formData.get("file") as File;

    // 파일 존재 확인
    if (!file) {
      return ctx.error("File is required");
    }

    // 파일 크기 제한 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return ctx.error("File too large (max 5MB)");
    }

    // 파일 타입 확인
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return ctx.error("Invalid file type");
    }

    // 파일 확장자 확인 (MIME 스푸핑 방지)
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["jpg", "jpeg", "png", "webp"].includes(ext || "")) {
      return ctx.error("Invalid file extension");
    }

    // 안전하게 처리
    const buffer = await file.arrayBuffer();
    // ... 저장 로직
  });
```

## XSS 방지를 위한 출력 이스케이프

```typescript
import { escapeHtml } from "@/lib/security";

// HTML 컨텍스트에서 사용될 데이터
const safeContent = escapeHtml(userInput);

// 또는 라이브러리 사용
import DOMPurify from "isomorphic-dompurify";
const sanitized = DOMPurify.sanitize(userHtml);
```

Reference: [OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
