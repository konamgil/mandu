import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3333";

test("chat works end to end", async ({ page }) => {
  page.setDefaultTimeout(60000);

  const logs: string[] = [];
  page.on("console", (msg) => logs.push(msg.text()));
  page.on("pageerror", (err) => logs.push(`ERROR: ${err.message}`));

  await page.goto(BASE_URL);
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Type and submit
  await page.locator("input[type='text']").fill("hi");
  await page.locator("button[type='submit']").click();

  // User msg should appear
  await expect(page.locator("text=hi").first()).toBeVisible({ timeout: 3000 });
  console.log("STEP 1: User message visible");

  // Wait for assistant response - check every second if page is responsive
  for (let i = 0; i < 15; i++) {
    const alive = await page.evaluate(() => document.body.innerText.length).catch(() => -1);
    if (alive === -1) {
      console.log(`STEP 2: Second ${i} - page BLOCKED`);
      continue;
    }
    console.log(`STEP 2: Second ${i} - page alive, text length: ${alive}`);

    // Check for assistant content
    const bubbles = await page.locator("div[style*='border-radius: 16px 16px 16px 4px']").count();
    if (bubbles > 0) {
      const lastText = await page.locator("div[style*='border-radius: 16px 16px 16px 4px']").last().innerText().catch(() => "");
      if (lastText.length > 5) {
        console.log("STEP 3: Assistant responded:", lastText.slice(0, 100));
        return; // SUCCESS
      }
    }
    await page.waitForTimeout(1000);
  }

  // Dump errors
  const errors = logs.filter(l => l.includes("ERROR") || l.includes("error"));
  if (errors.length) console.log("ERRORS:", errors);

  expect(false).toBe(true); // fail
});
