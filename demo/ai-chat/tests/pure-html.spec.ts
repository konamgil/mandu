import { test, expect } from "@playwright/test";

test("pure HTML SSE test (no Mandu runtime)", async ({ page }) => {
  await page.goto("http://localhost:3333/public/test.html");
  await expect(page.locator("h1")).toBeVisible({ timeout: 5000 });

  await page.locator("#btn").click();
  await page.waitForTimeout(8000);

  const output = await page.locator("#output").innerText();
  console.log("Output length:", output.length);
  console.log("Output:", output.slice(0, 200));
  expect(output.length).toBeGreaterThan(10);

  // Page should still be responsive
  const alive = await page.evaluate(() => "alive");
  expect(alive).toBe("alive");
});
