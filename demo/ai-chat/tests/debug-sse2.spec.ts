import { test, expect } from "@playwright/test";

test("debug SSE content", async ({ page }) => {
  const logs: string[] = [];

  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

  // Inject console.log into the fetch to see what's happening
  await page.addInitScript(() => {
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      if (url.includes('/api/chat')) {
        console.log('[DEBUG] Chat fetch response status:', res.status);
        console.log('[DEBUG] Chat fetch response ok:', res.ok);
        console.log('[DEBUG] Chat response headers content-type:', res.headers.get('content-type'));
        // Clone to read body without consuming
        const clone = res.clone();
        const reader = clone.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let chunks = '';
          const readChunk = async () => {
            const { done, value } = await reader.read();
            if (done) {
              console.log('[DEBUG] SSE stream ended. Total:', chunks.length, 'chars');
              return;
            }
            const text = decoder.decode(value, { stream: true });
            chunks += text;
            console.log('[DEBUG] SSE chunk:', JSON.stringify(text.slice(0, 200)));
            readChunk();
          };
          readChunk();
        }
      }
      return res;
    };
  });

  await page.goto("http://localhost:3333");
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  const input = page.locator("input[type='text']");
  await input.fill("hi");
  await page.locator("button[type='submit']").click();
  await page.waitForTimeout(8000);

  console.log("=== ALL LOGS ===");
  for (const log of logs) {
    if (log.includes("DEBUG")) console.log(log);
  }
});
