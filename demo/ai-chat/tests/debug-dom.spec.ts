import { test } from "@playwright/test";

test("dump DOM after send", async ({ page }) => {
  await page.goto("http://localhost:3333");
  await page.waitForTimeout(5000);

  // Send
  await page.locator("input[type='text']").fill("hi");
  await page.locator("button[type='submit']").click();
  await page.waitForTimeout(12000);

  // Get full HTML of root
  const html = await page.evaluate(() => document.getElementById("root")?.innerHTML.slice(0, 2000) || "NO ROOT");
  console.log("=== DOM ===");
  console.log(html);
});
