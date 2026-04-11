import { test, expect } from "@playwright/test";

test("check what blocks", async ({ page }) => {
  page.setDefaultTimeout(60000);

  await page.goto("http://localhost:3333");
  await expect(page.locator("text=Mandu Chat")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Inject monitoring before submitting
  await page.evaluate(() => {
    // Monitor what blocks the main thread
    let lastCheck = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastCheck;
      if (delta > 500) {
        console.log(`[BLOCK] Main thread blocked for ${delta}ms`);
      }
      lastCheck = now;
    }, 100);

    // Monitor all XHR
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method: string, url: string) {
      console.log(`[XHR] ${method} ${url}`);
      origOpen.apply(this, arguments as any);
    };

    (window as any).__stopMonitor = () => clearInterval(interval);
  });

  await page.locator("input[type='text']").fill("hi");
  await page.locator("button[type='submit']").click();

  // Check responsiveness every 500ms
  for (let i = 0; i < 20; i++) {
    const t = await page.evaluate(() => Date.now()).catch(() => -1);
    console.log(`Check ${i}: ${t === -1 ? 'BLOCKED' : 'alive'}`);
    if (t !== -1 && i > 3) {
      // After a few seconds, check DOM
      const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
      console.log("Body text:", text);
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
});
