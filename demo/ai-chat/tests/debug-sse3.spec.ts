import { test, expect } from "@playwright/test";

test("debug SSE with console logs", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[Chat]") || text.includes("Mandu")) logs.push(text);
  });
  page.on("pageerror", (err) => logs.push(`[PAGE_ERROR] ${err.message}`));

  await page.goto("http://localhost:3333");
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  const input = page.locator("input[type='text']");
  await input.fill("hi");
  await page.locator("button[type='submit']").click();
  await page.waitForTimeout(10000);

  console.log("=== LOGS ===");
  for (const log of logs) console.log(log);

  // Check streaming happened
  const chatLogs = logs.filter(l => l.includes("[Chat]"));
  console.log("Chat-specific logs:", chatLogs.length);
  expect(chatLogs.length).toBeGreaterThan(0);
});
