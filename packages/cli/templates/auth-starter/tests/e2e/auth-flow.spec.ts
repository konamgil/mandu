/**
 * End-to-end validation for the Phase 2 auth pipeline.
 *
 * Covers the full user journey (signup → dashboard → logout → login) plus
 * the edge cases that exercise each middleware: CSRF protection on a
 * direct API POST, a wrong-password path, and duplicate-email rejection.
 *
 * Each test uses its own Playwright context (default — one per test) so
 * cookies/sessions don't bleed between cases. Emails are randomized so
 * ordering within the file doesn't matter.
 */
import { test, expect, request as apiRequest } from "@playwright/test";

function freshEmail(prefix: string = "user"): string {
  // Keeps rerunning the spec repeatedly safe against the in-memory store
  // (which accumulates across test runs since we don't restart the server).
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

const STRONG_PASSWORD = "correct-horse-battery";
const ANOTHER_PASSWORD = "another-correct-horse";

test.describe("auth flow", () => {
  test("signup with fresh email lands on /dashboard with the email visible", async ({ page }) => {
    const email = freshEmail("signup-fresh");

    await page.goto("/signup");
    await expect(page.getByTestId("signup-form")).toBeVisible();

    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();

    await page.waitForURL("**/dashboard");
    await expect(page.getByTestId("dashboard-email")).toHaveText(email);
  });

  test("logout returns to / and re-protects /dashboard", async ({ page }) => {
    const email = freshEmail("logout");

    // Register + land on dashboard.
    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();
    await page.waitForURL("**/dashboard");

    // Log out via the dashboard's own button.
    await page.getByTestId("dashboard-logout").click();
    await page.waitForURL("**/");

    // Going back to /dashboard now redirects to /login.
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await expect(page.getByTestId("login-form")).toBeVisible();
  });

  test("login with correct credentials lands on /dashboard", async ({ page }) => {
    const email = freshEmail("login-ok");

    // Seed the account.
    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();
    await page.waitForURL("**/dashboard");

    // Log out then log back in.
    await page.getByTestId("dashboard-logout").click();
    await page.waitForURL("**/");

    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(STRONG_PASSWORD);
    await page.getByTestId("login-submit").click();

    await page.waitForURL("**/dashboard");
    await expect(page.getByTestId("dashboard-email")).toHaveText(email);
  });

  test("login with wrong password shows an error on /login (no session)", async ({ page }) => {
    const email = freshEmail("login-bad");

    // Seed account.
    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();
    await page.waitForURL("**/dashboard");

    await page.getByTestId("dashboard-logout").click();
    await page.waitForURL("**/");

    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(ANOTHER_PASSWORD); // wrong
    await page.getByTestId("login-submit").click();

    // Bounces back to /login with ?error=...
    await page.waitForURL(/\/login\?/);
    await expect(page.getByTestId("login-error")).toBeVisible();

    // And /dashboard is still protected — we're not logged in.
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
  });

  test("signup with an existing email shows the duplicate error", async ({ page }) => {
    const email = freshEmail("dup");

    // First signup succeeds.
    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();
    await page.waitForURL("**/dashboard");

    // Log out so the second attempt looks like a guest.
    await page.getByTestId("dashboard-logout").click();
    await page.waitForURL("**/");

    // Second signup with the same email should be rejected.
    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();

    await page.waitForURL(/\/signup\?/);
    await expect(page.getByTestId("signup-error")).toBeVisible();
  });

  test("visiting /dashboard without a session redirects to /login", async ({ page }) => {
    // Fresh context — no cookies.
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await expect(page.getByTestId("login-form")).toBeVisible();
  });

  test("direct POST to /api/login without CSRF token returns 403", async ({ baseURL }) => {
    // Uses a fresh request context with NO cookies, so neither the CSRF
    // cookie nor the form field token is present. The csrf() middleware
    // will reject with 403.
    const ctx = await apiRequest.newContext({ baseURL: baseURL ?? "http://localhost:3333" });
    try {
      const res = await ctx.post("/api/login", {
        form: {
          email: "whoever@example.test",
          password: "whatever",
          // intentionally no _csrf field
        },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3.3: avatar upload — exercises scheduler-adjacent module wiring
  // and the POST /api/avatar handler.
  // ─────────────────────────────────────────────────────────────────────────

  // Minimal valid 1x1 PNG. `setInputFiles` accepts a `{name, mimeType, buffer}`
  // object so we can synthesize bytes without touching the filesystem.
  // prettier-ignore
  const PNG_1x1 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  test("logged-in user uploads a valid PNG and sees it on the dashboard", async ({ page }) => {
    const email = freshEmail("avatar-ok");

    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();
    await page.waitForURL("**/dashboard");

    // Pre-upload: the empty-state placeholder is visible.
    await expect(page.getByTestId("avatar-empty")).toBeVisible();

    await page.getByTestId("avatar-input").setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await page.getByTestId("avatar-submit").click();

    // The handler redirects back to /dashboard with ?uploadOk=1.
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByTestId("avatar-success")).toBeVisible();

    const img = page.getByTestId("avatar-image");
    await expect(img).toBeVisible();

    // Confirm the actual GET handler is wired + serves an image.
    const src = await img.getAttribute("src");
    expect(src).not.toBeNull();
    const res = await page.request.get(src as string);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("unauthenticated POST to /api/avatar is rejected (401 / redirect)", async ({ baseURL }) => {
    // Fresh context → no session cookie. We must still obtain a CSRF cookie
    // + token, otherwise csrf() returns 403 before the auth check runs —
    // which would mask the unauth-specific behaviour we want to assert.
    const ctx = await apiRequest.newContext({ baseURL: baseURL ?? "http://localhost:3333" });
    try {
      // 1. Visit any GET page so the server sets a fresh __csrf cookie.
      const seedRes = await ctx.get("/login");
      expect(seedRes.status()).toBe(200);

      // 2. Read the cookie back to get the token value.
      const cookies = await ctx.storageState();
      const csrfCookie = cookies.cookies.find((c) => c.name === "__csrf");
      expect(csrfCookie).toBeTruthy();
      const token = csrfCookie!.value;

      // 3. POST with JSON Accept so the handler takes the 401 branch rather
      //    than emitting a 302 to /login — asserting against a stable status
      //    is more informative than asserting against a redirect target.
      const res = await ctx.post("/api/avatar", {
        multipart: {
          _csrf: token,
          avatar: {
            name: "pixel.png",
            mimeType: "image/png",
            buffer: PNG_1x1,
          },
        },
        headers: { accept: "application/json" },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6.3: app/not-found.tsx — hitting a missing route renders the
  // user-defined 404 page (verifies end-to-end wiring of `notFound()` +
  // `registerNotFoundHandler()` + the `not-found.tsx` convention).
  // ─────────────────────────────────────────────────────────────────────────
  test("navigating to a missing URL renders app/not-found.tsx", async ({ page }) => {
    const res = await page.goto("/this-path-does-not-exist-" + Date.now());
    // Server returns 404 …
    expect(res?.status()).toBe(404);
    // … and our user-defined 404 component is rendered (not the built-in
    // JSON error page — we'd see raw JSON if the handler weren't wired).
    await expect(page.getByTestId("not-found-page")).toBeVisible();
    await expect(page.getByTestId("not-found-heading")).toHaveText("404 — Not Found");
  });

  test("avatar upload rejects non-image files (400 + dashboard error banner)", async ({ page }) => {
    const email = freshEmail("avatar-bad");

    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-confirm").fill(STRONG_PASSWORD);
    await page.getByTestId("signup-submit").click();
    await page.waitForURL("**/dashboard");

    // Upload a .txt — the MIME allow-list in uploads.ts will reject it.
    await page.getByTestId("avatar-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await page.getByTestId("avatar-submit").click();

    // Handler redirects to /dashboard?uploadError=unsupported-type; we assert
    // both the URL shape and the inline banner.
    await page.waitForURL(/\/dashboard\?uploadError=/);
    await expect(page.getByTestId("avatar-error")).toBeVisible();
    // And the avatar slot still shows the empty placeholder (upload refused).
    await expect(page.getByTestId("avatar-empty")).toBeVisible();
  });
});
