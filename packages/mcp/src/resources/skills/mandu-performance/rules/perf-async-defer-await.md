---
title: Defer await to Where Actually Used
impact: CRITICAL
impactDescription: Eliminates unnecessary blocking
tags: performance, async, await, slot
---

## Defer await to Where Actually Used

**Impact: CRITICAL (Eliminates unnecessary blocking)**

await는 실제로 값이 필요한 시점까지 지연하세요. 함수 시작에서 모든 것을 await하면 불필요한 블로킹이 발생합니다.

**Incorrect (너무 일찍 await):**

```typescript
// spec/slots/user.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(async (ctx) => {
    const userId = ctx.params.id;

    // ❌ 캐시 확인 전에 DB 쿼리 시작하고 대기
    const user = await fetchUserFromDB(userId);

    // 캐시에 있으면 DB 쿼리는 불필요했음
    const cached = cache.get(`user:${userId}`);
    if (cached) {
      return ctx.ok(cached);
    }

    return ctx.ok(user);
  });
```

**Correct (필요한 시점에 await):**

```typescript
// spec/slots/user.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(async (ctx) => {
    const userId = ctx.params.id;

    // 캐시 먼저 확인
    const cached = cache.get(`user:${userId}`);
    if (cached) {
      return ctx.ok(cached);  // DB 쿼리 안 함
    }

    // ✅ 캐시 미스일 때만 DB 쿼리
    const user = await fetchUserFromDB(userId);
    cache.set(`user:${userId}`, user);

    return ctx.ok(user);
  });
```

## Promise 시작은 일찍, await는 늦게

```typescript
export default Mandu.filling()
  .get(async (ctx) => {
    // ✅ Promise 시작 (블로킹 없음)
    const userPromise = fetchUser(ctx.params.id);
    const configPromise = fetchConfig();

    // 동기 작업 수행
    const requestId = generateRequestId();
    const timestamp = Date.now();
    logRequest(requestId, timestamp);

    // ✅ 필요한 시점에 await
    const [user, config] = await Promise.all([userPromise, configPromise]);

    return ctx.ok({ user, config, requestId });
  });
```

## 조건부 분기에서의 활용

```typescript
export default Mandu.filling()
  .get(async (ctx) => {
    const { type } = ctx.query;

    if (type === "summary") {
      // 요약만 필요하면 상세 데이터 불필요
      const summary = await fetchSummary(ctx.params.id);
      return ctx.ok({ summary });
    }

    // 상세 데이터가 필요한 경우에만 fetch
    const [summary, details] = await Promise.all([
      fetchSummary(ctx.params.id),
      fetchDetails(ctx.params.id),
    ]);

    return ctx.ok({ summary, details });
  });
```
