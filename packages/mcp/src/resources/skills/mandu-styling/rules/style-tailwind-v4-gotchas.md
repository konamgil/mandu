---
title: Tailwind CSS v4 Gotchas
impact: HIGH
impactDescription: Critical breaking changes when using or migrating to Tailwind v4
tags: styling, tailwind, v4, gotchas, migration, breaking-changes
---

## Tailwind CSS v4 Gotchas

**Impact: HIGH (Critical breaking changes when using or migrating to Tailwind v4)**

Tailwind v4는 완전히 재작성된 프레임워크입니다. v3에서 마이그레이션 시 반드시 확인해야 할 주의사항입니다.

## Browser Support

```
Safari 16.4+ | Chrome 111+ | Firefox 128+
```

> **Warning:** IE 및 구형 브라우저 지원 불가. 레거시 프로젝트는 v3 유지 권장.

## Import Syntax 변경

```css
/* v3 (deprecated) */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* v4 (required) */
@import "tailwindcss";
```

## Important Modifier 위치 변경

```css
/* v3 */
!bg-red-500

/* v4 - 끝에 위치 */
bg-red-500!
```

## Custom Utilities 문법 변경

```css
/* v3 */
@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}

/* v4 - @utility 사용 */
@utility text-balance {
  text-wrap: balance;
}
```

## Stacked Variants 순서 변경

```html
<!-- v3: right-to-left (hover가 dark보다 우선) -->
<div class="dark:hover:bg-blue-500">

<!-- v4: left-to-right (dark가 hover보다 우선) -->
<div class="dark:hover:bg-blue-500">
```

> v4에서는 왼쪽부터 적용되므로 variant 순서에 주의하세요.

## CSS Variable Syntax 변경

```html
<!-- v3 -->
<div class="bg-[var(--brand-color)]">
<div class="bg-[--brand-color]">

<!-- v4 - 괄호 문법 사용 -->
<div class="bg-(--brand-color)">
```

## hover: 동작 변경

```html
<!-- v4에서 hover:는 hover 지원 기기에서만 적용 -->
<!-- 터치 기기에서는 적용되지 않음 -->
<button class="hover:bg-blue-500">

<!-- 모든 기기에서 적용하려면 -->
<button class="hover:bg-blue-500 active:bg-blue-500">
```

## Default Color 변경

```css
/* v4 기본값 변경 */
border-color: currentColor; /* v3: gray-200 */
ring-width: 1px;           /* v3: 3px */
ring-color: currentColor;   /* v3: blue-500/50 */
```

> 기존 디자인이 깨질 수 있으니 명시적 색상 지정 권장.

## Transform 초기화 변경

```html
<!-- v3 -->
<div class="transform-none">

<!-- v4 - 개별 속성 사용 -->
<div class="scale-none rotate-none translate-none">
```

## space-* / divide-* 선택자 변경

```html
<!-- 레이아웃이 깨지면 gap으로 대체 -->
<div class="flex gap-4">  <!-- space-x-4 대신 -->
<div class="grid gap-4">  <!-- space-y-4 대신 -->
```

## CSS Modules에서 Theme 변수 접근

```css
/* Component.module.css */
@reference "tailwindcss";  /* v4 필수 */

.button {
  background-color: var(--color-primary);
}
```

## Prefix 설정 변경

```css
/* v3: tailwind.config.js */
module.exports = { prefix: 'tw-' }

/* v4: CSS에서 설정 */
@import "tailwindcss" prefix(tw);

/* 사용 시 콜론 형식 */
<div class="tw:bg-blue-500">
```

## Mandu 특화 주의사항

### Island 컴포넌트에서 @reference

```tsx
// Island에서 CSS Modules 사용 시
import styles from './Counter.module.css';

// Counter.module.css에 @reference 필수
```

### SSR과 CSS 순서

Mandu의 CSS Auto-Build는 `/.mandu/client/globals.css`에 출력합니다.
SSR 시 이 경로로 자동 주입되므로 별도 설정 불필요.

### HMR 동작

CSS 변경 시 `css-update` HMR 메시지로 스타일시트만 교체됩니다.
페이지 전체 리로드 없이 스타일 변경 확인 가능.

## 마이그레이션 체크리스트

- [ ] Browser support 확인 (Safari 16.4+)
- [ ] `@tailwind` → `@import "tailwindcss"` 변경
- [ ] `tailwind.config.ts` 삭제, `@theme`으로 이전
- [ ] `postcss.config.js` 삭제
- [ ] Important modifier 위치 변경 (`!` → 끝)
- [ ] `@layer utilities` → `@utility` 변경
- [ ] CSS variable 문법 확인 `[--var]` → `(--var)`
- [ ] space-*/divide-* 레이아웃 확인

Reference: [Tailwind CSS v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide)
