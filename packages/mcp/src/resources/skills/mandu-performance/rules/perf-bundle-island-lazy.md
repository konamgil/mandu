---
title: Lazy Load Islands with Dynamic Import
impact: CRITICAL
impactDescription: 40-60% smaller initial bundle
tags: performance, bundle, island, lazy, dynamic-import
---

## Lazy Load Islands with Dynamic Import

**Impact: CRITICAL (40-60% smaller initial bundle)**

무거운 Island 컴포넌트는 동적 import로 lazy loading하세요. 초기 번들에서 제외되어 페이지 로드가 빨라집니다.

**Incorrect (즉시 로드):**

```tsx
// app/dashboard/page.tsx
import HeavyChart from "./client";  // ❌ 200KB 차트 라이브러리 즉시 로드
import DataTable from "./table.client";  // ❌ 150KB 테이블 라이브러리 즉시 로드

export default function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <HeavyChart data={chartData} />
      <DataTable rows={tableData} />
    </div>
  );
}
```

**Correct (lazy loading):**

```tsx
// app/dashboard/page.tsx
import { lazy, Suspense } from "react";

// ✅ 동적 import로 코드 스플리팅
const HeavyChart = lazy(() => import("./client"));
const DataTable = lazy(() => import("./table.client"));

export default function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>

      <Suspense fallback={<ChartSkeleton />}>
        <HeavyChart data={chartData} />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <DataTable rows={tableData} />
      </Suspense>
    </div>
  );
}
```

## 조건부 로딩

사용자 액션 시에만 로드:

```tsx
"use client";

import { lazy, Suspense, useState } from "react";

const HeavyEditor = lazy(() => import("./editor.client"));

export default function EditorToggle() {
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div>
      <button onClick={() => setShowEditor(true)}>
        Edit
      </button>

      {showEditor && (
        <Suspense fallback={<p>Loading editor...</p>}>
          <HeavyEditor />
        </Suspense>
      )}
    </div>
  );
}
```

## Preload on Hover

호버 시 미리 로드하여 체감 속도 향상:

```tsx
"use client";

import { lazy, Suspense, useState } from "react";

// 프리로드 함수 분리
const editorImport = () => import("./editor.client");
const HeavyEditor = lazy(editorImport);

export default function EditorToggle() {
  const [showEditor, setShowEditor] = useState(false);

  const handleMouseEnter = () => {
    // ✅ 호버 시 프리로드 시작
    editorImport();
  };

  return (
    <div>
      <button
        onMouseEnter={handleMouseEnter}
        onClick={() => setShowEditor(true)}
      >
        Edit
      </button>

      {showEditor && (
        <Suspense fallback={<p>Loading...</p>}>
          <HeavyEditor />
        </Suspense>
      )}
    </div>
  );
}
```

## Island Priority와 함께 사용

```tsx
// 뷰포트 진입 시 로드 (기본값)
<Island priority="visible">
  <Suspense fallback={<Skeleton />}>
    <LazyComponent />
  </Suspense>
</Island>

// 브라우저 유휴 시 로드
<Island priority="idle">
  <Suspense fallback={<Skeleton />}>
    <LazyAnalytics />
  </Suspense>
</Island>
```
