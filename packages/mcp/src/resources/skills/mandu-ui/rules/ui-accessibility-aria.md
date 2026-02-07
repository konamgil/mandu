---
title: ARIA Patterns
impact: HIGH
impactDescription: Screen reader support and semantic markup
tags: ui, accessibility, aria, screen-reader
---

## ARIA Patterns

**Impact: HIGH (Screen reader support and semantic markup)**

스크린 리더 사용자를 위한 ARIA 속성과 시맨틱 마크업을 구현하세요.

## ARIA 기본 원칙

```tsx
// 1. 네이티브 HTML 우선 (No ARIA > ARIA)
// ❌
<div role="button" tabIndex={0} onClick={handleClick}>Click</div>

// ✅
<button onClick={handleClick}>Click</button>

// 2. 네이티브가 부족할 때만 ARIA 사용
<div
  role="tablist"
  aria-label="Settings tabs"
>
  <button role="tab" aria-selected="true">General</button>
  <button role="tab" aria-selected="false">Security</button>
</div>
```

## 일반적인 ARIA 패턴

### 버튼

```tsx
// 아이콘 버튼
<button aria-label="Close dialog">
  <XIcon aria-hidden="true" />
</button>

// 토글 버튼
<button
  aria-pressed={isActive}
  onClick={() => setIsActive(!isActive)}
>
  {isActive ? "Active" : "Inactive"}
</button>

// 로딩 버튼
<button disabled={isLoading} aria-busy={isLoading}>
  {isLoading ? "Submitting..." : "Submit"}
</button>
```

### 폼

```tsx
// 라벨 연결
<label htmlFor="email">Email</label>
<input
  id="email"
  type="email"
  aria-describedby="email-hint email-error"
  aria-invalid={!!error}
/>
<p id="email-hint">We'll never share your email</p>
{error && <p id="email-error" role="alert">{error}</p>}

// 필수 필드
<label htmlFor="name">
  Name <span aria-hidden="true">*</span>
</label>
<input id="name" required aria-required="true" />
```

### 알림

```tsx
// 중요 알림 (스크린 리더가 즉시 읽음)
<div role="alert" aria-live="assertive">
  Error: Invalid credentials
</div>

// 부드러운 알림 (현재 읽기 완료 후)
<div role="status" aria-live="polite">
  3 items added to cart
</div>

// 라이브 영역
<div aria-live="polite" aria-atomic="true">
  Search results: {count} items found
</div>
```

### 모달 다이얼로그

```tsx
// app/dialog/client.tsx
export function DialogIsland({ open, title, children, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      <h2 id="dialog-title">{title}</h2>
      <div id="dialog-description">
        {children}
      </div>
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

### 탭

```tsx
export function TabsIsland() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div>
      <div role="tablist" aria-label="Settings">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === index}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === index ? 0 : -1}
            onClick={() => setActiveTab(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={activeTab !== index}
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
```

### 메뉴

```tsx
<nav aria-label="Main navigation">
  <ul role="menubar">
    <li role="none">
      <a role="menuitem" href="/">Home</a>
    </li>
    <li role="none">
      <button
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        Products
      </button>
      {isOpen && (
        <ul role="menu" aria-label="Products submenu">
          <li role="none">
            <a role="menuitem" href="/products/new">New</a>
          </li>
        </ul>
      )}
    </li>
  </ul>
</nav>
```

## 숨김 처리

```tsx
// 스크린 리더에서만 표시
<span className="sr-only">Currently on page 3 of 10</span>

// 스크린 리더에서 숨김 (장식용)
<span aria-hidden="true">🎉</span>

// Tailwind sr-only 클래스
// .sr-only {
//   position: absolute;
//   width: 1px;
//   height: 1px;
//   padding: 0;
//   margin: -1px;
//   overflow: hidden;
//   clip: rect(0, 0, 0, 0);
//   border: 0;
// }
```

## 테스트

```bash
# axe-core로 접근성 검사
bun add -d @axe-core/playwright
```

```typescript
// tests/e2e/accessibility.spec.ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("should have no accessibility violations", async ({ page }) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});
```

Reference: [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
