---
title: Communicate Between Islands with useIslandEvent
impact: MEDIUM
impactDescription: Enables Island-to-Island data flow
tags: composition, island, event, communication
---

## Communicate Between Islands with useIslandEvent

**Impact: MEDIUM (Enables Island-to-Island data flow)**

Island는 기본적으로 격리되어 있습니다. `useIslandEvent`를 사용하여 Island 간 통신하세요.

**Incorrect (전역 상태 공유):**

```tsx
// ❌ 전역 변수로 Island 간 통신
let globalCount = 0;

// Island A
export function CounterIsland() {
  const [count, setCount] = useState(globalCount);
  // 다른 Island와 동기화되지 않음
}
```

**Correct (useIslandEvent):**

```tsx
// Island A: Counter (이벤트 발송)
"use client";

import { useState } from "react";
import { useIslandEvent } from "@mandujs/core/client";

export function CounterIsland() {
  const [count, setCount] = useState(0);
  const { emit } = useIslandEvent<{ count: number }>("counter-update");

  const increment = () => {
    const newCount = count + 1;
    setCount(newCount);
    emit({ count: newCount });  // 다른 Island에 알림
  };

  return <button onClick={increment}>Count: {count}</button>;
}
```

```tsx
// Island B: Display (이벤트 수신)
"use client";

import { useState } from "react";
import { useIslandEvent } from "@mandujs/core/client";

export function DisplayIsland() {
  const [lastCount, setLastCount] = useState(0);

  useIslandEvent<{ count: number }>("counter-update", (data) => {
    setLastCount(data.count);  // 카운터 업데이트에 반응
  });

  return <p>Last count received: {lastCount}</p>;
}
```

## 실용적인 패턴

### 장바구니 업데이트

```tsx
// Product Island
function ProductIsland({ product }) {
  const { emit } = useIslandEvent("cart-update");

  const addToCart = () => {
    emit({ action: "add", productId: product.id, quantity: 1 });
  };

  return <button onClick={addToCart}>Add to Cart</button>;
}

// Cart Island
function CartIsland() {
  const [items, setItems] = useState([]);

  useIslandEvent<CartEvent>("cart-update", ({ action, productId, quantity }) => {
    if (action === "add") {
      setItems(prev => [...prev, { productId, quantity }]);
    }
  });

  return <CartSummary items={items} />;
}

// Header Cart Badge Island
function CartBadgeIsland() {
  const [count, setCount] = useState(0);

  useIslandEvent<CartEvent>("cart-update", ({ action }) => {
    if (action === "add") setCount(c => c + 1);
    if (action === "remove") setCount(c => c - 1);
  });

  return <span className="badge">{count}</span>;
}
```

### 필터 동기화

```tsx
// Filter Island
function FilterIsland() {
  const { emit } = useIslandEvent("filter-change");
  const [filters, setFilters] = useState({});

  const updateFilter = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    emit(newFilters);
  };

  return <FilterControls filters={filters} onChange={updateFilter} />;
}

// Product List Island
function ProductListIsland({ initialProducts }) {
  const [products, setProducts] = useState(initialProducts);

  useIslandEvent<Filters>("filter-change", async (filters) => {
    const filtered = await fetchProducts(filters);
    setProducts(filtered);
  });

  return <ProductGrid products={products} />;
}
```

## API 요약

```typescript
// 이벤트 발송
const { emit } = useIslandEvent<T>(eventName);
emit(data);

// 이벤트 수신
useIslandEvent<T>(eventName, (data) => { ... });

// 발송 + 수신
const { emit } = useIslandEvent<T>(eventName, (data) => { ... });
```

## 언제 useIslandEvent를 사용하나?

| 상황 | 권장 방법 |
|------|-----------|
| 같은 Island 내 상태 공유 | useState/useContext |
| 부모-자식 Island | props |
| 형제 Island 간 통신 | **useIslandEvent** |
| 페이지 전체 상태 | slot + server state |
