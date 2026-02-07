---
title: Use Promise.all() for Independent Operations
impact: CRITICAL
impactDescription: 2-10× improvement
tags: performance, async, parallel, promises, slot
---

## Use Promise.all() for Independent Operations

**Impact: CRITICAL (2-10× improvement)**

독립적인 비동기 작업은 `Promise.all()`로 병렬 실행하세요. 순차 실행은 각 await마다 전체 네트워크 지연을 추가합니다.

**Incorrect (순차 실행, 3번의 왕복):**

```typescript
// spec/slots/dashboard.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(async (ctx) => {
    // ❌ 순차 실행: 300ms (100ms × 3)
    const user = await fetchUser(ctx.get("userId"));
    const posts = await fetchPosts(ctx.get("userId"));
    const notifications = await fetchNotifications(ctx.get("userId"));

    return ctx.ok({ user, posts, notifications });
  });
```

**Correct (병렬 실행, 1번의 왕복):**

```typescript
// spec/slots/dashboard.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(async (ctx) => {
    const userId = ctx.get("userId");

    // ✅ 병렬 실행: 100ms (가장 느린 것 기준)
    const [user, posts, notifications] = await Promise.all([
      fetchUser(userId),
      fetchPosts(userId),
      fetchNotifications(userId),
    ]);

    return ctx.ok({ user, posts, notifications });
  });
```

## 부분 의존성이 있는 경우

일부 작업이 다른 작업의 결과에 의존하는 경우:

```typescript
export default Mandu.filling()
  .get(async (ctx) => {
    // 1단계: 독립적인 작업 병렬 실행
    const [user, config] = await Promise.all([
      fetchUser(ctx.get("userId")),
      fetchConfig(),
    ]);

    // 2단계: user에 의존하는 작업 병렬 실행
    const [posts, followers] = await Promise.all([
      fetchPosts(user.id),
      fetchFollowers(user.id),
    ]);

    return ctx.ok({ user, config, posts, followers });
  });
```

## Promise.allSettled() 사용

일부 실패를 허용하는 경우:

```typescript
const results = await Promise.allSettled([
  fetchUser(userId),
  fetchPosts(userId),   // 실패해도 OK
  fetchNotifications(userId),  // 실패해도 OK
]);

const [userResult, postsResult, notificationsResult] = results;

return ctx.ok({
  user: userResult.status === "fulfilled" ? userResult.value : null,
  posts: postsResult.status === "fulfilled" ? postsResult.value : [],
  notifications: notificationsResult.status === "fulfilled" ? notificationsResult.value : [],
});
```

Reference: [MDN Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)
