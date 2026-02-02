---
title: E2E Testing with Playwright
impact: MEDIUM
impactDescription: Validates complete user flows
tags: testing, e2e, playwright, browser
---

## E2E Testing with Playwright

**Impact: MEDIUM (Validates complete user flows)**

Playwright를 사용하여 실제 브라우저에서 End-to-End 테스트를 실행하세요.

**Playwright 설정:**

```bash
# 설치
bun add -d @playwright/test
bunx playwright install
```

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

**기본 E2E 테스트:**

```typescript
// tests/e2e/home.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test("should display welcome message", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  });

  test("should navigate to about page", async ({ page }) => {
    await page.goto("/");

    await page.click('a[href="/about"]');

    await expect(page).toHaveURL("/about");
    await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  });
});
```

## 인증 플로우 테스트

```typescript
// tests/e2e/auth.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should login successfully", async ({ page }) => {
    await page.goto("/login");

    // 폼 입력
    await page.fill('input[name="email"]', "test@example.com");
    await page.fill('input[name="password"]', "password123");

    // 제출
    await page.click('button[type="submit"]');

    // 리다이렉트 확인
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText("Welcome back")).toBeVisible();
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await page.goto("/login");

    await page.fill('input[name="email"]', "wrong@example.com");
    await page.fill('input[name="password"]', "wrongpassword");
    await page.click('button[type="submit"]');

    await expect(page.getByText("Invalid credentials")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("should logout", async ({ page }) => {
    // 먼저 로그인
    await page.goto("/login");
    await page.fill('input[name="email"]', "test@example.com");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');

    // 로그아웃
    await page.click('button[aria-label="Logout"]');

    await expect(page).toHaveURL("/");
    await expect(page.getByText("Login")).toBeVisible();
  });
});
```

## 인증 상태 재사용

```typescript
// tests/e2e/auth.setup.ts
import { test as setup, expect } from "@playwright/test";

const authFile = "tests/.auth/user.json";

setup("authenticate", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "test@example.com");
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL("/dashboard");

  // 인증 상태 저장
  await page.context().storageState({ path: authFile });
});
```

```typescript
// tests/e2e/dashboard.spec.ts
import { test, expect } from "@playwright/test";

// 저장된 인증 상태 사용
test.use({ storageState: "tests/.auth/user.json" });

test("should access dashboard when logged in", async ({ page }) => {
  await page.goto("/dashboard");

  // 로그인 상태로 바로 접근 가능
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
```

## API 모킹

```typescript
test("should display mocked data", async ({ page }) => {
  // API 응답 모킹
  await page.route("/api/users", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        users: [{ id: 1, name: "Mocked User" }],
      }),
    });
  });

  await page.goto("/users");

  await expect(page.getByText("Mocked User")).toBeVisible();
});
```

## 테스트 실행

```bash
# 모든 테스트
bunx playwright test

# 특정 파일
bunx playwright test tests/e2e/auth.spec.ts

# UI 모드
bunx playwright test --ui

# 디버그 모드
bunx playwright test --debug

# 리포트 보기
bunx playwright show-report
```

Reference: [Playwright Documentation](https://playwright.dev/docs/intro)
