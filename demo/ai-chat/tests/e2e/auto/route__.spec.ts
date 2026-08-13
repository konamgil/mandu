import { test, expect } from "@playwright/test";


test.describe("route:/", () => {
  test("smoke /", async ({ page, request, baseURL }) => {
    const url = (baseURL ?? "http://localhost:3333") + "/";
    // L0: no console.error / uncaught exception / 5xx
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(url);

    // L1: Domain-aware structure signals (generic)
    await expect(page.locator("main, [role='main']")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.locator("a, button").count()).toBeGreaterThanOrEqual(1);
    await expect(page).toHaveTitle(/.+/);
    // L2: SSR data injection verification
    const manduDataEl = page.locator("#__MANDU_DATA__");
    const dataCount = await manduDataEl.count();
    if (dataCount > 0) {
      const raw = await manduDataEl.textContent();
      expect(() => JSON.parse(raw!)).not.toThrow();
    }
    expect(errors, "console/page errors").toEqual([]);
  });
});
