---
title: Use React.cache() for Request Deduplication
impact: HIGH
impactDescription: Eliminates duplicate queries within request
tags: performance, cache, react-cache, deduplication, slot
---

## Use React.cache() for Request Deduplication

**Impact: HIGH (Eliminates duplicate queries within request)**

`React.cache()`를 사용하여 단일 요청 내에서 중복 쿼리를 제거하세요. 인증 확인과 데이터베이스 쿼리에 특히 효과적입니다.

**사용법:**

```typescript
// lib/auth.ts
import { cache } from "react";

export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;

  return await db.user.findUnique({
    where: { id: session.user.id },
  });
});
```

단일 요청 내에서 `getCurrentUser()`를 여러 번 호출해도 쿼리는 한 번만 실행됩니다.

**Incorrect (항상 캐시 미스):**

```typescript
// ❌ 인라인 객체는 매번 새 참조 생성
const getUser = cache(async (params: { uid: number }) => {
  return await db.user.findUnique({ where: { id: params.uid } });
});

// 각 호출이 새 객체, 캐시 미스
getUser({ uid: 1 });
getUser({ uid: 1 });  // 캐시 미스, 쿼리 다시 실행
```

**Correct (캐시 히트):**

```typescript
// ✅ 프리미티브 인자는 값 동등성 사용
const getUser = cache(async (uid: number) => {
  return await db.user.findUnique({ where: { id: uid } });
});

getUser(1);
getUser(1);  // ✅ 캐시 히트, 캐시된 결과 반환
```

## Mandu Slot에서의 활용

```typescript
// lib/data.ts
import { cache } from "react";

export const getProductWithCategory = cache(async (productId: string) => {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: { category: true },
  });
  return product;
});

// spec/slots/product.slot.ts
import { Mandu } from "@mandujs/core";
import { getProductWithCategory } from "@/lib/data";

export default Mandu.filling()
  .get(async (ctx) => {
    const productId = ctx.params.id;

    // 여러 컴포넌트에서 호출해도 한 번만 실행
    const product = await getProductWithCategory(productId);

    return ctx.ok({ product });
  });
```

## React.cache() 적합한 사용 사례

- 데이터베이스 쿼리 (Prisma, Drizzle 등)
- 무거운 계산
- 인증 확인
- 파일 시스템 작업
- fetch가 아닌 모든 비동기 작업

## 주의사항

`React.cache()`는 요청 단위로 캐시됩니다. 요청 간 캐싱이 필요하면 LRU 캐시를 사용하세요.

Reference: [React.cache documentation](https://react.dev/reference/react/cache)
