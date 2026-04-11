import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3333";

test.describe("Mandu AI Chat", () => {
  test("page loads and island hydrates", async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for island hydration — sidebar should appear
    await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
    // Session list should load
    await expect(page.locator("nav")).toBeVisible({ timeout: 5000 });
  });

  test("session list loads from API", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
    // At least one session should exist (default)
    const sessions = page.locator("nav [role='button'], nav div[style*='cursor: pointer']");
    await expect(sessions.first()).toBeVisible({ timeout: 5000 });
  });

  test("can create a new session", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
    // Count sessions before
    const sessionsBefore = await page.locator("nav div[style*='cursor: pointer']").count();
    // Click + button
    await page.locator("button", { has: page.locator("svg path[d*='M12 5v14']") }).click();
    await page.waitForTimeout(1000);
    const sessionsAfter = await page.locator("nav div[style*='cursor: pointer']").count();
    expect(sessionsAfter).toBeGreaterThan(sessionsBefore);
  });

  test("can send message and receive response", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const input = page.locator("input[type='text']");
    await input.fill("hi");
    const assistantBubble = page.locator("div[style*='border-radius: 16px 16px 16px 4px']").last();

    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes("/api/chat"), { timeout: 10000 }),
      page.locator("button[type='submit']").click(),
    ]);

    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("text/event-stream");

    const lengths: number[] = [];
    for (let i = 0; i < 8; i++) {
      lengths.push((await assistantBubble.innerText().catch(() => "")).length);
      await page.waitForTimeout(150);
    }

    expect(lengths.some(length => length > 0)).toBeTruthy();
    expect(new Set(lengths.filter(length => length > 0)).size).toBeGreaterThan(1);
    await expect.poll(async () => (await assistantBubble.innerText().catch(() => "")).length, {
      timeout: 10000,
    }).toBeGreaterThan(40);
  });

  test("system prompt modal opens and saves", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });

    // Click system button
    await page.locator("text=system").click();

    // Modal should appear
    await expect(page.locator("text=시스템 프롬프트")).toBeVisible({ timeout: 3000 });

    // Edit prompt
    const textarea = page.locator("textarea");
    await textarea.fill("You are a helpful assistant.");

    // Save
    await page.locator("button", { hasText: "저장" }).click();

    // Modal should close
    await expect(page.locator("text=시스템 프롬프트")).not.toBeVisible({ timeout: 3000 });
  });

  test("API endpoints respond correctly", async ({ request }) => {
    // GET sessions
    const sessionsRes = await request.get(`${BASE_URL}/api/sessions`);
    expect(sessionsRes.ok()).toBeTruthy();
    const sessionsData = await sessionsRes.json();
    expect(sessionsData.sessions).toBeDefined();
    expect(Array.isArray(sessionsData.sessions)).toBeTruthy();

    // POST new session
    const newSessionRes = await request.post(`${BASE_URL}/api/sessions`, {
      data: { title: "Test Session" },
    });
    expect(newSessionRes.ok()).toBeTruthy();
    const newSession = await newSessionRes.json();
    expect(newSession.id).toBeDefined();
    expect(newSession.title).toBe("Test Session");

    // GET session by id
    const sessionRes = await request.get(`${BASE_URL}/api/sessions/${newSession.id}`);
    expect(sessionRes.ok()).toBeTruthy();

    // POST chat message
    const chatRes = await request.post(`${BASE_URL}/api/chat`, {
      data: { message: "hello", sessionId: newSession.id },
    });
    expect(chatRes.ok()).toBeTruthy();
    expect(chatRes.headers()["content-type"]).toContain("text/event-stream");
    const chatBody = await chatRes.text();
    expect(chatBody).toContain("event: token");
    expect(chatBody).toContain("event: done");

    // DELETE session
    const deleteRes = await request.delete(`${BASE_URL}/api/sessions`, {
      data: { sessionId: newSession.id },
    });
    expect(deleteRes.ok()).toBeTruthy();
  });
});
