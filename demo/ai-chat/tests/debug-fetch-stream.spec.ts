import { test, expect } from "@playwright/test";

test("fetch streaming works in browser", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (msg) => logs.push(msg.text()));

  await page.goto("http://localhost:3333");
  await page.waitForTimeout(2000);

  // Get a valid session ID
  const sessionId = await page.evaluate(async () => {
    const res = await fetch("/api/sessions");
    const data = await res.json();
    return data.sessions[0]?.id;
  });

  console.log("Session ID:", sessionId);

  // Test fetch streaming directly in browser
  const result = await page.evaluate(async (sid) => {
    const chunks: string[] = [];
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "test", sessionId: sid }),
      });
      console.log("[TEST] status:", res.status, "ok:", res.ok);
      const reader = res.body?.getReader();
      if (!reader) return { error: "no reader" };
      const decoder = new TextDecoder();
      let count = 0;
      const start = Date.now();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        chunks.push(text.slice(0, 50));
        count++;
        if (Date.now() - start > 5000) break; // 5s timeout
      }
      return { count, firstChunk: chunks[0], lastChunk: chunks[chunks.length - 1] };
    } catch (e: any) {
      return { error: e.message };
    }
  }, sessionId);

  console.log("Result:", JSON.stringify(result));
  expect(result.count).toBeGreaterThan(0);
});
