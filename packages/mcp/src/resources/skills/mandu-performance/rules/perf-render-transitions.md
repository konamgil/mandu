---
title: Use startTransition for Non-Urgent Updates
impact: MEDIUM
impactDescription: Prevents UI blocking on heavy updates
tags: performance, render, transitions, react
---

## Use startTransition for Non-Urgent Updates

**Impact: MEDIUM (Prevents UI blocking on heavy updates)**

`startTransition`으로 비긴급 업데이트를 표시하면 React가 긴급 업데이트(타이핑, 클릭)를 우선 처리합니다.

**Incorrect (모든 업데이트가 긴급):**

```tsx
"use client";

import { useState } from "react";

export default function SearchIsland() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  const handleChange = async (e) => {
    const value = e.target.value;
    setQuery(value);  // 긴급: 입력 반영

    // ❌ 검색도 긴급으로 처리 → 입력이 버벅임
    const data = await search(value);
    setResults(data);
  };

  return (
    <div>
      <input value={query} onChange={handleChange} />
      <ResultsList results={results} />
    </div>
  );
}
```

**Correct (비긴급 업데이트 분리):**

```tsx
"use client";

import { useState, useTransition } from "react";

export default function SearchIsland() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isPending, startTransition] = useTransition();

  const handleChange = async (e) => {
    const value = e.target.value;
    setQuery(value);  // 긴급: 입력 즉시 반영

    // ✅ 검색 결과는 비긴급
    startTransition(async () => {
      const data = await search(value);
      setResults(data);
    });
  };

  return (
    <div>
      <input value={query} onChange={handleChange} />
      {isPending && <Spinner />}
      <ResultsList results={results} />
    </div>
  );
}
```

## 무거운 리스트 필터링

```tsx
"use client";

import { useState, useTransition, useMemo } from "react";

export default function FilterableList({ items }) {
  const [filter, setFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  // ✅ 필터링을 transition으로 처리
  const handleFilterChange = (e) => {
    startTransition(() => {
      setFilter(e.target.value);
    });
  };

  const filteredItems = useMemo(
    () => items.filter((item) => item.name.includes(filter)),
    [items, filter]
  );

  return (
    <div>
      <input
        onChange={handleFilterChange}
        placeholder="Filter..."
      />
      <div style={{ opacity: isPending ? 0.7 : 1 }}>
        {filteredItems.map((item) => (
          <Item key={item.id} data={item} />
        ))}
      </div>
    </div>
  );
}
```

## 탭 전환

```tsx
"use client";

import { useState, useTransition } from "react";

export default function TabsIsland() {
  const [tab, setTab] = useState("home");
  const [isPending, startTransition] = useTransition();

  const handleTabChange = (newTab) => {
    // ✅ 탭 콘텐츠 로딩은 비긴급
    startTransition(() => {
      setTab(newTab);
    });
  };

  return (
    <div>
      <TabButtons activeTab={tab} onChange={handleTabChange} />
      <div style={{ opacity: isPending ? 0.5 : 1 }}>
        <TabContent tab={tab} />
      </div>
    </div>
  );
}
```

## 언제 사용하나요?

| 상황 | startTransition 사용 |
|------|---------------------|
| 타이핑, 클릭 반응 | ❌ (긴급) |
| 검색 결과 표시 | ✅ |
| 리스트 필터링 | ✅ |
| 탭/페이지 전환 | ✅ |
| 무거운 계산 결과 | ✅ |

Reference: [React useTransition](https://react.dev/reference/react/useTransition)
