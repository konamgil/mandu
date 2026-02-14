import { test, expect } from "@playwright/test";


test.describe("route:/", () => {
  test("smoke /", async ({ page, baseURL }) => {
    const url = (baseURL ?? "http://localhost:3333") + "/";
    // L0: no console.error / uncaught exception / 5xx
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(url);

    // L1: Domain-aware structure signals (generic)
    await expect(page.locator("main, [role='main']")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("a, button")).toHaveCount({ min: 1 });
    await expect(page).toHaveTitle(/.+/);
    expect(errors, "console/page errors").toEqual([]);
  });
});
