import { describe, expect, it } from "bun:test";
import { extractShellHtml, createPPRResponse, PPR_SHELL_MARKER } from "../../src/runtime/ppr";

describe("PPR - extractShellHtml", () => {
  it("strips closing tags and appends the shell marker", () => {
    const full = "<html><body><div>content</div></body></html>";
    const shell = extractShellHtml(full);
    expect(shell).toBe("<html><body><div>content</div>" + PPR_SHELL_MARKER);
    expect(shell).not.toContain("</body>");
    expect(shell).not.toContain("</html>");
  });

  it("handles whitespace between closing tags", () => {
    const full = "<html><body><div>x</div></body>  \n  </html>  ";
    const shell = extractShellHtml(full);
    expect(shell).toContain(PPR_SHELL_MARKER);
    expect(shell).not.toContain("</body>");
  });

  it("is case-insensitive for closing tags", () => {
    const full = "<html><body><p>hi</p></BODY></HTML>";
    const shell = extractShellHtml(full);
    expect(shell).toContain(PPR_SHELL_MARKER);
    expect(shell).not.toContain("</BODY>");
  });

  it("preserves full content when no closing tags present", () => {
    const fragment = "<div>partial</div>";
    const shell = extractShellHtml(fragment);
    expect(shell).toBe("<div>partial</div>" + PPR_SHELL_MARKER);
  });
});

describe("PPR - createPPRResponse", () => {
  it("returns a streaming response with cached shell + fresh data + closing tags", async () => {
    const shell = "<html><body><div>layout</div>" + PPR_SHELL_MARKER;
    const response = createPPRResponse(shell, "page/dashboard", { user: "Alice" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("X-Mandu-PPR")).toBe("shell-hit");

    const html = await response.text();

    // Shell is at the start
    expect(html).toContain("<div>layout</div>");
    expect(html).toContain(PPR_SHELL_MARKER);

    // Fresh data script is injected
    expect(html).toContain("window.__MANDU_DATA__");
    expect(html).toContain("page/dashboard");
    expect(html).toContain("Alice");

    // Document is properly closed
    expect(html).toMatch(/<\/body><\/html>$/);
  });

  it("escapes data to prevent XSS via inline script", async () => {
    const shell = "<html><body>" + PPR_SHELL_MARKER;
    const response = createPPRResponse(shell, "page/xss", {
      name: "</script><script>alert(1)</script>",
    });
    const html = await response.text();

    // The raw </script> must not appear unescaped in the output
    expect(html).not.toContain("</script><script>alert(1)</script>");
    // The data should still be present in escaped form
    expect(html).toContain("window.__MANDU_DATA__");
  });
});
