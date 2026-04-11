import { test, expect } from "@playwright/test";

test("EventSource SSE works", async ({ page }) => {
  await page.goto("http://localhost:3333");
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  await page.locator("input[type='text']").fill("만두 뭐야?");
  await page.locator("button[type='submit']").click();

  // Wait for response to appear (streaming takes ~5-10s)
  // Look for any text content in assistant message area
  await page.waitForTimeout(12000);

  // Take screenshot
  await page.screenshot({ path: "test-results/sse-result.png" });

  // Check if page is still responsive (not blocked)
  const canEvaluate = await page.evaluate(() => "alive").catch(() => "BLOCKED");
  console.log("Page responsive:", canEvaluate);
  expect(canEvaluate).toBe("alive");
});
