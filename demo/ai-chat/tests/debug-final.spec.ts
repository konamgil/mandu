import { test, expect } from "@playwright/test";

test("send message and check DOM for response", async ({ page }) => {
  await page.goto("http://localhost:3333");
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Send message
  await page.locator("input[type='text']").fill("hi");
  await page.locator("button[type='submit']").click();

  // User message should appear immediately
  await expect(page.locator("text=hi").first()).toBeVisible({ timeout: 3000 });
  console.log("User message appeared");

  // Wait for streaming — check for content appearing in the last assistant bubble
  // The assistant bubble starts empty (with dots), then fills with content
  await page.waitForTimeout(15000);

  // Dump the page text content to see what rendered
  const bodyText = await page.locator("main").innerText({ timeout: 3000 }).catch(() => "FAILED TO GET TEXT");
  console.log("=== PAGE MAIN CONTENT ===");
  console.log(bodyText.slice(0, 500));

  // Check if any response text appeared
  const hasContent = bodyText.length > 20;
  console.log("Has content:", hasContent, "Length:", bodyText.length);
});
