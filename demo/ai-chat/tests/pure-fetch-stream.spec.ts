import { test, expect } from "@playwright/test";

test("fetch ReadableStream without React", async ({ page }) => {
  await page.goto("http://localhost:3333/public/test2.html");
  await expect(page.locator("h1")).toBeVisible({ timeout: 5000 });

  await page.locator("#btn").click();

  // Check page responsiveness during streaming
  for (let i = 0; i < 15; i++) {
    const alive = await page.evaluate(() => document.getElementById("output")?.textContent?.length || 0).catch(() => -1);
    console.log(`Second ${i}: ${alive === -1 ? 'BLOCKED' : `alive, output=${alive} chars`}`);
    if (alive > 100) break;
    await page.waitForTimeout(1000);
  }

  const output = await page.locator("#output").innerText();
  console.log("Final output length:", output.length);
  expect(output.length).toBeGreaterThan(10);
});
