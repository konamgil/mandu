---
title: "Mandu Rendering — Render × Hydration 조합 가이드"
audience: 사용자 (Mandu 앱 개발자) + AI 에이전트
last_updated: 2026-04-21
---

# Rendering — Render × Hydration 20 조합을 한 앱에서 섞어 쓰기

> Mandu 의 시그니처 기능: 한 앱 안에서 페이지마다 **어떻게 렌더할지(서버)** 와 **어떻게 하이드레이트할지(클라이언트)** 를 독립적으로 고릅니다. Next.js 도 Astro 도 이 조합을 전부 주지는 않습니다.

---

## 한 장 요약

```
Render 5 가지 × Hydration 4 가지 = 20 조합.
페이지마다 독립 선택. 앱 안에서 섞어 쓰기 자유.
SPA 네비는 글로벌 toggle + 링크 단위 opt-out.
```

**경쟁 프레임워크 비교** — 다른 문서: [README "Why Mandu"](../README.md#why-mandu--whats-actually-different).

---

## 축 1: Render 모드 (서버 측)

| 모드 | 언제 쓰나 | 구현 위치 |
|---|---|---|
| **dynamic** | 매 요청 렌더 (로그인 사용자 대시보드, 개인화) | [`runtime/server.ts`](../packages/core/src/runtime/server.ts) |
| **isr** | 콘텐츠 주기적 갱신 (상품 / 블로그 / 뉴스) | [`runtime/cache.ts`](../packages/core/src/runtime/cache.ts) |
| **swr** | 즉시 응답 + 백그라운드 재검증 | [`runtime/cache.ts`](../packages/core/src/runtime/cache.ts) |
| **ppr** | 쉘 즉시 + 느린 영역은 stream (`Suspense`) | [`runtime/streaming-ssr.ts`](../packages/core/src/runtime/streaming-ssr.ts) |
| **static** | 빌드 타임 prerender (랜딩 / 문서) | [`bundler/prerender.ts`](../packages/core/src/bundler/prerender.ts) |

### dynamic — 매 요청 SSR

```ts
// app/dashboard/page.tsx
import { route } from "@mandujs/core/routes";

export default route()
  .render("dynamic")  // 명시 안 해도 기본값
  .handle(async ({ session }) => {
    const user = session.user!;
    const stats = await db.userStats.get(user.id);
    return <Dashboard user={user} stats={stats} />;
  });
```

- **TTFB**: 요청 처리 시간에 비례.
- **캐싱**: 없음.
- **개인화**: 완전 지원 (session / cookies / headers 전부 접근 가능).

### isr — Incremental Static Regeneration

```ts
// app/products/[id]/page.tsx
export default route()
  .render("isr", {
    revalidate: 120,           // 120 초마다 재생성
    tags: ["products", "catalog"],  // revalidateTag() 로 수동 무효화 가능
  })
  .handle(async ({ params }) => {
    const product = await db.products.get(params.id);
    return <ProductPage product={product} />;
  });
```

- **첫 요청**: SSR 렌더링 + 캐시 저장.
- **다음 요청 (캐시 유효)**: 캐시된 HTML 즉시 반환 (TTFB 한 자릿수 ms).
- **캐시 만료 후 다음 요청**: 만료된 캐시 즉시 반환 + 백그라운드에서 재생성 (SWR 패턴의 일부).
- **수동 무효화**:

```ts
import { revalidateTag } from "@mandujs/core/runtime";

// 어드민이 상품 수정한 직후
await revalidateTag("products");
```

### swr — Stale-While-Revalidate

ISR 의 변형. 캐시 만료 **직후** 와 만료 **대기 중** 동작이 다름:

- **isr**: 만료된 건 버리고 새로 렌더 (첫 사용자가 대기).
- **swr**: 만료돼도 일단 stale 반환 + 백그라운드에서 fresh 생성.

```ts
export default route()
  .render("swr", { revalidate: 60, maxStale: 300 })  // 60 초 fresh, 300 초 까지 stale 허용
  .handle(...);
```

### ppr — Partial Prerendering (streaming)

쉘은 즉시 보내고, 느린 영역은 `Suspense` 경계 뒤에서 stream:

```ts
// app/feed/page.tsx
import { Suspense } from "react";
import { route } from "@mandujs/core/routes";

async function SlowFeed() {
  const items = await expensiveQuery();  // 느린 쿼리
  return <FeedList items={items} />;
}

export default route()
  .render("ppr")
  .handle(() => (
    <div>
      <Header />                             {/* 즉시 stream */}
      <Suspense fallback={<FeedSkeleton />}>
        <SlowFeed />                         {/* 완료되면 HTML chunk 추가 */}
      </Suspense>
      <Footer />                             {/* 즉시 stream */}
    </div>
  ));
```

- **TTFB**: 쉘만 기준 → 수 ms.
- **Total blocking time**: `Suspense` fallback 덕분에 interaction 가능한 상태가 빠름.
- **SEO**: 스트림 완성 후 최종 HTML 이 크롤러에 노출됨.

### static — 빌드 타임 prerender

```ts
// app/about/page.tsx
export default route()
  .render("static")
  .handle(() => <AboutPage />);

// app/blog/[slug]/page.tsx — dynamic route 도 static 가능
export default route()
  .render("static")
  .generateStaticParams(async () => {
    const posts = await fetchAllPostSlugs();
    return posts.map((slug) => ({ slug }));
  })
  .handle(async ({ params }) => {
    const post = await loadPost(params.slug);
    return <BlogPost post={post} />;
  });
```

- `mandu build` 시 모든 param 조합에 대해 HTML 생성 → `.mandu/static/...`.
- 런타임에서는 파일 읽어서 반환 (nginx / CDN 에 맡겨도 됨).
- `params` 에 없는 값 접근 시 `dynamicParams: true` 이면 on-demand SSR, `false` 면 404.

---

## 축 2: Hydration 전략 (클라이언트 측)

| 전략 | 클라이언트 JS | 설명 |
|---|---|---|
| **none** | **0 KB** | 순수 HTML. React 하이드레이션 없음. SPA 네비만 동작. |
| **island** (기본) | island 바이너리만 | `[data-island="X"]` 만 하이드레이트. 페이지 대부분은 정적 HTML. |
| **full** | 전체 페이지 트리 | React 전체 트리 하이드레이트. SPA 에 가까운 행동. |
| **progressive** | 조건 충족 시 | `visible` / `idle` / `interaction` / `media(query)` 트리거. |

### hydration: "none" — 클라이언트 JS 0

```ts
// app/docs/[[...slug]]/page.tsx
export default route()
  .render("static")
  .hydration("none")             // 중요 — client JS 번들 생성 자체 안 함
  .handle(...);
```

- Runtime JS 가 페이지에 전혀 포함되지 않음 (SPA nav 헬퍼 제외).
- 폼 제출 / `<a href>` 네비 모두 브라우저 기본 동작으로.
- **적합**: 문서 / 블로그 / 마케팅 / 법적 고지 페이지.

### hydration: "island" — 부분 하이드레이션 (기본값)

```ts
// app/blog/[slug]/page.tsx
export default route()
  .render("isr", { revalidate: 3600 })
  // .hydration("island")  // 명시 안 해도 기본값
  .handle(async ({ params }) => {
    const post = await loadPost(params.slug);
    return (
      <article>
        <h1>{post.title}</h1>
        <MarkdownBody html={post.html} />         {/* 정적 */}
        <CommentsIsland postId={post.id} />       {/* island — interactive */}
        <ShareButtons />                          {/* island */}
      </article>
    );
  });
```

- 페이지 대부분은 SSR HTML 그대로 / React 트리 복원 안 함.
- `*.client.tsx` 로 선언한 island 만 별도 번들 + 하이드레이트.
- 페이지 레벨 하이드레이션 우선순위는 route hydration 설정으로 지정합니다.

### hydration: "full" — 전체 페이지 하이드레이션

```ts
// app/editor/[docId]/page.tsx
export default route()
  .render("dynamic")
  .hydration("full")             // 에디터는 전체가 interactive
  .handle(async ({ params, session }) => {
    const doc = await db.docs.get(params.docId);
    return <DocumentEditor initialDoc={doc} user={session.user!} />;
  });
```

- SSR 후 `hydrateRoot()` 로 전체 트리 하이드레이션.
- 기존 SPA 프레임워크 체험과 가장 유사.
- **비용**: 전체 트리의 JS 번들 필요 → TTI 느려질 수 있음.

### hydration: "progressive" — 조건부

```ts
// app/gallery/page.tsx
export default route()
  .hydration("progressive", { trigger: "visible" })
  .handle(...);

// 인라인 interactive 영역:
// app/components/Chart.partial.tsx
import { partial } from "@mandujs/core/client";

export default partial({ id: "Chart", component: Chart, priority: "idle" });
```

- **visible**: IntersectionObserver 로 viewport 진입 시.
- **idle**: `requestIdleCallback` (없으면 setTimeout fallback).
- **interaction**: pointerdown / focus / keydown 중 처음.
- **media(query)**: matchMedia 일치 시.
- SSR 페이지에서 쓰려면 `export const hydration = { strategy: "island" }`
  를 페이지에 두고 `<ChartPartial.Render ... />` 를 렌더링합니다.

---

## 두 축의 조합 매트릭스 (20 cases)

|  | dynamic | isr | swr | ppr | static |
|---|:---:|:---:|:---:|:---:|:---:|
| **none** | ⭐ 관리자 read-only | ⭐ 공개 API 상세 | ⚠️ 거의 없음 | ⚠️ 거의 없음 | ⭐⭐⭐ 문서/랜딩 |
| **island** (기본) | ⭐⭐ 대시보드 일부 | ⭐⭐⭐ **블로그/상품** | ⭐⭐ 뉴스 | ⭐⭐ 피드/리스트 | ⭐⭐ 마케팅 + CTA |
| **full** | ⭐⭐⭐ 에디터/대시보드 | ⭐ 제품 리스트 + 필터 | ⭐ 실시간 데이터 | ⭐⭐ 복잡한 스트림 UI | ⚠️ (거의 없음) |
| **progressive** | ⭐ drawer-heavy UI | ⭐⭐ 갤러리/피드 | ⭐ 스크롤 무한 | ⭐⭐ 긴 문서 + widget | ⭐ 긴 랜딩 |

⭐⭐⭐ 전형적 / ⭐⭐ 자주 / ⭐ 드물지만 합리 / ⚠️ 거의 안 쓰임

### 실전 레시피

```ts
// 1. 마케팅 랜딩 — static + none
route().render("static").hydration("none")

// 2. 문서 사이트 — static + none + sidebar island
route().render("static").hydration("island")  // island 는 사이드바만

// 3. 블로그 포스트 — isr + island (댓글만 interactive)
route().render("isr", { revalidate: 3600 }).hydration("island")

// 4. 상품 상세 — isr + island (장바구니 버튼만)
route().render("isr", { revalidate: 120, tags: ["products"] }).hydration("island")

// 5. 뉴스 피드 — swr + progressive (스크롤 시 로드)
route().render("swr").hydration("progressive", { trigger: "visible" })

// 6. 사용자 대시보드 — dynamic + full (완전 SPA 느낌)
route().render("dynamic").hydration("full")

// 7. 문서 에디터 — dynamic + full (실시간 협업)
route().render("dynamic").hydration("full")

// 8. 관리자 read-only 리포트 — dynamic + none (보기만)
route().render("dynamic").hydration("none")

// 9. 공개 API JSON — dynamic + 렌더 없음 (API route)
route().handle(async () => Response.json({ ... }))
```

---

## 축 3: SPA 네비게이션 (글로벌 + 링크 단위)

SPA 네비 = 페이지 간 이동 시 **full page reload** 대신 client router 가 HTML 조각 fetch + 쉘 교체.

### 글로벌 설정

```ts
// mandu.config.ts
export default {
  spa: true,           // 기본값. 모든 내부 링크 SPA 네비.
  // spa: false,       // 전통적 MPA — 링크 클릭 = full reload.
};
```

### 링크 단위 opt-out

```tsx
<a href="/external-like-flow" data-mandu-no-spa>
  Full reload 필요
</a>
```

- OAuth redirect, file download, iframe 전환 등 full reload 가 필요한 곳.

### View Transitions API 통합

`config.transitions: true` (기본) 이면 브라우저의 View Transitions API 를 자동 활용 → 페이지 간 애니메이션 자연스럽게.

### Hash 앵커 보존

SPA 네비로 이동해도 `#section` 해시 있으면 해당 element 까지 자동 스크롤 (이슈 #222 에서 수정).

---

## Pure CSR 근사 (SSR 를 완전히 끄고 싶을 때)

Mandu 는 전용 "CSR only" 모드가 **없습니다**. 모든 페이지는 최소한 한 번 서버가 렌더합니다. 하지만 근사는 가능:

### 패턴 1: 쉘만 SSR + 전체 페이지를 client island 로

```tsx
// app/app/page.tsx
import { route } from "@mandujs/core/routes";

export default route()
  .render("static")
  .hydration("full")
  .handle(() => (
    <div id="app-root" data-island="ClientApp" />
  ));
```

```tsx
// app/ClientApp.client.tsx
import { wrapComponent } from "@mandujs/core/client";
import { useState, useEffect } from "react";

function ClientApp() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/api/data").then(r => r.json()).then(setData);
  }, []);

  return <>{data ? <Main data={data} /> : <LoadingSpinner />}</>;
}

export default wrapComponent(ClientApp);
```

- 서버는 빈 div 하나만 렌더링 → 사실상 `index.html + app.js` 형태.
- 전통적 CRA / Vite SPA 경험과 거의 동일.

### 왜 전용 CSR 모드 없나

1. **SEO**: Pure CSR 은 크롤러에 빈 HTML 보임. 대부분 안티 패턴.
2. **TTFB**: 정적 쉘도 SSR 하면 CDN 에 캐시 가능 → TTFB 동일.
3. **관리 비용**: "CSR only" 옵션 추가하면 bundler / dev 서버 / 프리렌더러 전 영역에 분기 추가 — ROI 낮음.

**Next.js 도 같은 결론**. Astro 는 컴포넌트 단위 `client:only` 제공. Mandu 는 island 로 그걸 대체합니다.

---

## 자주 묻는 질문

### Q. `hydration: "none"` 인데 어떻게 `<a>` SPA 네비가 되나?
A. SPA nav 헬퍼는 *프레임워크* 레벨에서 추가되는 얇은 IIFE 입니다 (~3KB, 아래 설명 참조). `hydration: "none"` 페이지에도 기본으로 주입되고, `config.spa: false` 로 완전히 뺄 수 있습니다.

### Q. `isr` 와 `swr` 중 뭘 쓰나?
A. 쓰기 빈도 + TTFB 민감도:
- **isr**: 캐시 만료 후 첫 사용자는 새 렌더 대기. 쓰기 낮음, fresh 중요.
- **swr**: 만료 상관없이 즉시 stale 반환. 쓰기 높음, freshness 허용.

### Q. `ppr` 에서 `Suspense` 경계 내부가 에러나면?
A. React 의 `ErrorBoundary` 로 감싸면 fallback 렌더링. Mandu 가 emit 하는 에러 boundary 는 `[data-mandu-error-boundary]` attribute 달려 있어 E2E 에서 추적 가능.

### Q. 한 페이지 안에서 여러 interactive 영역이 다른 hydration 전략을 써도 되나?
A. 네. 페이지 레벨 island 는 route hydration 우선순위를 따르고, 인라인 영역은 `partial({ priority })` 로 `"visible"`, `"idle"`, `"interaction"` 등을 지정합니다.

### Q. `static` + `hydration: "full"` 조합은 언제 쓰나?
A. 거의 안 씁니다. 전체 트리를 client 에서 복원할 거면 서버 렌더링 한 번의 비용이 정당화 안 됨. 그 경우 보통 `static + island` 로 interactive 부분만 분리합니다.

---

## 내부 구현 링크

- **Render mode 정의**: [`spec/schema.ts`](../packages/core/src/spec/schema.ts) — `RenderMode` union (`dynamic | isr | swr | ppr`) + `SpecHydrationStrategy`.
- **ISR / SWR 캐시**: [`runtime/cache.ts`](../packages/core/src/runtime/cache.ts) — `MemoryCacheStore`, `revalidateTag`, `revalidatePath`.
- **PPR 스트리밍**: [`runtime/streaming-ssr.ts`](../packages/core/src/runtime/streaming-ssr.ts), [`runtime/ssr.ts`](../packages/core/src/runtime/ssr.ts).
- **Static prerender**: [`bundler/prerender.ts`](../packages/core/src/bundler/prerender.ts).
- **Hydration 전략 실행**: [`client/hydrate.ts`](../packages/core/src/client/hydrate.ts), [`bundler/build.ts`](../packages/core/src/bundler/build.ts).
- **SPA nav**: [`client/spa-nav-helper.ts`](../packages/core/src/client/spa-nav-helper.ts), [`client/router.ts`](../packages/core/src/client/router.ts).
- **View Transitions**: [`client/router.ts`](../packages/core/src/client/router.ts) — `transitions` config branch.

---

*이 문서는 Mandu 의 렌더링 시스템이 "Next.js 의 ISR + Astro 의 island + Qwik 의 resumability 가까운 progressive 하이드레이션" 을 **하나의 프레임워크에서** 제공한다는 것을 구체 코드로 증명합니다. 다른 어디에도 없는 조합입니다.*
