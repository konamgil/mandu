import { test, expect } from "@playwright/test";

test("debug SSE streaming", async ({ page }) => {
  const logs: string[] = [];
  const errors: string[] = [];

  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => errors.push(err.message));

  // Intercept chat API to see what happens
  page.on("response", (res) => {
    if (res.url().includes("/api/chat")) {
      logs.push(`[RESPONSE] ${res.url()} status=${res.status()} content-type=${res.headers()["content-type"]}`);
    }
  });

  page.on("requestfailed", (req) => {
    logs.push(`[REQ_FAILED] ${req.url()} ${req.failure()?.errorText}`);
  });

  await page.goto("http://localhost:3333");
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });

  // Wait for session to load
  await page.waitForTimeout(2000);

  // Type and send
  const input = page.locator("input[type='text']");
  await input.fill("test message");
  await page.locator("button[type='submit']").click();

  // Wait for network activity
  await page.waitForTimeout(5000);

  // Print all logs
  console.log("=== CONSOLE LOGS ===");
  for (const log of logs) console.log(log);
  console.log("=== PAGE ERRORS ===");
  for (const err of errors) console.log(err);

  // Check if there's an error response
  const hasError = logs.some(l => l.includes("[RESPONSE]") && !l.includes("status=200"));
  const hasSSE = logs.some(l => l.includes("text/event-stream"));

  console.log(`=== SUMMARY: hasError=${hasError}, hasSSE=${hasSSE} ===`);

  // The test itself - we want to see what's happening
  expect(errors.length).toBe(0);
});
