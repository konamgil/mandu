import { test, expect } from "@playwright/test";

test("debug send button click", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto("http://localhost:3333");
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Check if input is disabled
  const inputDisabled = await page.locator("input[type='text']").isDisabled();
  console.log("Input disabled:", inputDisabled);

  // Check if sessions loaded
  const sessionCount = await page.locator("nav div[style*='cursor']").count();
  console.log("Sessions count:", sessionCount);

  // Check submit button state
  const input = page.locator("input[type='text']");
  await input.fill("test");
  const btnDisabled = await page.locator("button[type='submit']").isDisabled();
  console.log("Button disabled after typing:", btnDisabled);

  // Try submitting
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes("/api/chat"), { timeout: 5000 }).catch(() => null),
    page.locator("button[type='submit']").click(),
  ]);

  console.log("Chat API response:", response ? `${response.status()} ${response.headers()['content-type']}` : "NO RESPONSE - fetch never happened");

  // Wait and check logs
  await page.waitForTimeout(3000);
  console.log("=== ALL LOGS ===");
  for (const l of logs) console.log(l);
});
