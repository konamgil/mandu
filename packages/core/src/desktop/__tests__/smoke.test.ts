/**
 * @mandujs/core/desktop — smoke tests
 *
 * Integration-shaped assertions: the barrel re-exports what we expect, the
 * optional peer is genuinely optional (tests pass with it absent), and the
 * demo fixture is present.
 *
 * The browser-visible smoke (actual WebView window opening) runs only when
 * a `MANDU_DESKTOP_E2E=1` env flag is set AND the peer is installed. CI
 * skips it unconditionally.
 */

import { describe, it, expect } from "bun:test";
import path from "path";
import fs from "fs";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
const demoPath = path.join(repoRoot, "demo", "desktop-starter");

describe("@mandujs/core/compat/desktop — smoke", () => {
  it("barrel exports createWindow and the type surface", async () => {
    const mod = await import("../index");
    expect(typeof mod.createWindow).toBe("function");
    // Type-only exports don't survive runtime introspection; the fact
    // that the import succeeds without throwing is the meaningful part.
  });

  it("worker entry is importable without a running Worker host", async () => {
    // Importing worker.ts outside a Worker context must not crash — the
    // module guards on `globalThis.addEventListener` presence. In Bun main
    // thread, `addEventListener` exists on globalThis (as a DOM-compat
    // shim), so the installer runs but just doesn't receive messages.
    const mod = await import("../worker");
    expect(typeof mod._installHandler).toBe("function");
    expect(typeof mod._postToParent).toBe("function");
  });

  it("demo/desktop-starter fixture exists", () => {
    const exists = fs.existsSync(demoPath);
    expect(exists).toBe(true);
  });

  it("demo/desktop-starter has a package.json with webview-bun peer", () => {
    const pkgPath = path.join(demoPath, "package.json");
    const pkgRaw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw);
    expect(pkg.name).toBe("mandu-desktop-starter");
    // webview-bun should appear either in dependencies or peerDependencies
    const combined = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    };
    expect("webview-bun" in combined).toBe(true);
  });

  it("demo/desktop-starter has a desktop entry file", () => {
    const entryPath = path.join(demoPath, "src", "desktop", "main.ts");
    const exists = fs.existsSync(entryPath);
    expect(exists).toBe(true);
    const contents = fs.readFileSync(entryPath, "utf-8");
    // The entry should wire Worker + startServer — sanity-check key symbols.
    expect(contents).toContain("startServer");
    expect(contents).toContain("Worker");
  });

  it("demo/desktop-starter has minimal app/ routes", () => {
    const appDir = path.join(demoPath, "app");
    const exists = fs.existsSync(appDir);
    expect(exists).toBe(true);
    const pagePath = path.join(appDir, "page.tsx");
    expect(fs.existsSync(pagePath)).toBe(true);
  });
});

// Describe block that runs only when explicitly enabled. Left as a
// placeholder for local Windows smoke — no assertions on CI.
const canOpenWindow =
  process.env.MANDU_DESKTOP_E2E === "1" &&
  (process.platform === "win32" ||
    process.platform === "darwin" ||
    process.platform === "linux");

describe.skipIf(!canOpenWindow)(
  "@mandujs/core/compat/desktop — browser smoke (opt-in)",
  () => {
    it("opens and closes a data: URL window", async () => {
      const { createWindow } = await import("../window");
      const handle = await createWindow({
        url: "data:text/html,<h1>Mandu smoke</h1>",
        title: "Mandu E2E",
        width: 400,
        height: 300,
      });
      // Close immediately — we only assert the handle is constructible.
      await handle.close();
      await handle.closed;
    });
  },
);
