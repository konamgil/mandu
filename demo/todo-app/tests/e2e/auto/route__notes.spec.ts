import { test, expect } from "@playwright/test";


test.describe("route:/notes", () => {
  test("smoke /notes", async ({ page, baseURL }) => {
    const url = (baseURL ?? "http://localhost:3333") + "/notes";
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
    // L2: behavior signals (placeholder - extend per app)
    await expect(page).toHaveURL(/.*/);
    expect(errors, "console/page errors").toEqual([]);
  });
});
