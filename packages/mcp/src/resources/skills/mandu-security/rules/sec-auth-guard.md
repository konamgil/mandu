---
title: Use guard() for Authentication Checks
impact: CRITICAL
impactDescription: Prevents unauthorized access
tags: security, auth, guard, slot
---

## Use guard() for Authentication Checks

**Impact: CRITICAL (Prevents unauthorized access)**

모든 보호된 slot에서 `guard()`를 사용하여 인증을 확인하세요. guard는 핸들러 실행 전에 검사됩니다.

**Vulnerable (인증 없음):**

```typescript
// ❌ 인증 체크 없이 민감 데이터 노출
export default Mandu.filling()
  .get(async (ctx) => {
    const users = await db.user.findMany();
    return ctx.ok({ users });  // 누구나 접근 가능!
  });
```

**Secure (guard로 인증):**

```typescript
// ✅ guard로 인증 체크
export default Mandu.filling()
  .guard((ctx) => {
    const user = ctx.get("user");
    if (!user) {
      return ctx.unauthorized("Authentication required");
    }
    // void 반환 시 계속 진행
  })
  .get(async (ctx) => {
    const users = await db.user.findMany();
    return ctx.ok({ users });
  });
```

## 역할 기반 접근 제어 (RBAC)

```typescript
export default Mandu.filling()
  .guard((ctx) => {
    const user = ctx.get("user");

    if (!user) {
      return ctx.unauthorized("Login required");
    }

    if (!user.roles.includes("admin")) {
      return ctx.forbidden("Admin access required");
    }
  })
  .get(async (ctx) => {
    // 관리자만 접근 가능
    const sensitiveData = await db.audit.findMany();
    return ctx.ok({ data: sensitiveData });
  });
```

## 리소스 소유권 검증

```typescript
export default Mandu.filling()
  .guard(async (ctx) => {
    const user = ctx.get("user");
    const resourceId = ctx.params.id;

    if (!user) {
      return ctx.unauthorized("Login required");
    }

    // 리소스 소유권 확인
    const resource = await db.resource.findUnique({
      where: { id: resourceId },
    });

    if (resource?.ownerId !== user.id) {
      return ctx.forbidden("You don't own this resource");
    }

    // 나중에 사용할 수 있도록 저장
    ctx.set("resource", resource);
  })
  .get((ctx) => {
    const resource = ctx.get("resource");
    return ctx.ok({ resource });
  })
  .delete(async (ctx) => {
    const resource = ctx.get("resource");
    await db.resource.delete({ where: { id: resource.id } });
    return ctx.noContent();
  });
```

## 다중 guard 체이닝

```typescript
const requireAuth = (ctx) => {
  if (!ctx.get("user")) {
    return ctx.unauthorized("Login required");
  }
};

const requireAdmin = (ctx) => {
  if (!ctx.get("user")?.isAdmin) {
    return ctx.forbidden("Admin required");
  }
};

export default Mandu.filling()
  .guard(requireAuth)
  .guard(requireAdmin)  // 순차적으로 실행
  .get(/* ... */);
```

## 주의사항

- guard에서 응답을 반환하면 핸들러가 실행되지 않음
- void 반환 시 다음 guard 또는 핸들러로 진행
- 인증 미들웨어에서 `ctx.set("user", user)`로 사용자 정보 저장

Reference: [OWASP Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
