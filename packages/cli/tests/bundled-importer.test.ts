/**
 * #184 / #187: bundled-importer end-to-end test
 *
 * Reproduces the exact bug from #184: a page that transitively imports a
 * shared util should pick up edits to the shared file without a dev server
 * restart.
 *
 * Strategy: write a tiny project to a tmpdir, build a `createBundledImporter`
 * pointed at that tmpdir, import the page module, then mutate the transitive
 * shared file and import again. The two values must differ.
 *
 * If this test fails, #184 is back.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createBundledImporter, importFresh } from "../src/util/bun";

interface PageModule {
  default: () => string;
}

describe("createBundledImporter (#184/#187)", () => {
  let rootDir: string;
  let pagePath: string;
  let sharedPath: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "mandu-bundled-import-"));
    mkdirSync(path.join(rootDir, "src/shared"), { recursive: true });
    mkdirSync(path.join(rootDir, "src/server"), { recursive: true });
    mkdirSync(path.join(rootDir, "app"), { recursive: true });

    sharedPath = path.join(rootDir, "src/shared/translations.ts");
    writeFileSync(
      sharedPath,
      'export default { hero: { subtitle: "원본 텍스트" } };\n',
    );

    // 중간 server util — translations를 import해서 쓰는 함수
    const serverUtilPath = path.join(rootDir, "src/server/i18n.ts");
    writeFileSync(
      serverUtilPath,
      `import translations from "../shared/translations.ts";
export function getSubtitle(): string {
  return translations.hero.subtitle;
}
`,
    );

    pagePath = path.join(rootDir, "app/page.ts");
    writeFileSync(
      pagePath,
      `import { getSubtitle } from "../src/server/i18n.ts";
export default function Page() {
  return getSubtitle();
}
`,
    );
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Windows may briefly hold cache locks
    }
  });

  it("baseline: importFresh(page) does NOT pick up shared.ts edits (proves the bug exists)", async () => {
    const first = (await importFresh(pagePath)) as PageModule;
    expect(first.default()).toBe("원본 텍스트");

    writeFileSync(sharedPath, 'export default { hero: { subtitle: "새 텍스트" } };\n');
    await new Promise((r) => setTimeout(r, 30));

    const second = (await importFresh(pagePath)) as PageModule;
    // The whole point of #184 — importFresh fails to propagate the edit.
    expect(second.default()).toBe("원본 텍스트");
  });

  it("createBundledImporter picks up transitive shared.ts edits across reloads (#184 fix)", async () => {
    const importBundled = createBundledImporter({ rootDir });

    const first = (await importBundled(pagePath)) as PageModule;
    expect(first.default()).toBe("원본 텍스트");

    writeFileSync(sharedPath, 'export default { hero: { subtitle: "새 텍스트" } };\n');
    await new Promise((r) => setTimeout(r, 30));

    const second = (await importBundled(pagePath)) as PageModule;
    // The reporter's exact failing case — must now pass.
    expect(second.default()).toBe("새 텍스트");
  });

  it("createBundledImporter handles multi-hop transitive chains", async () => {
    // Add another layer: shared → utils → translations
    mkdirSync(path.join(rootDir, "src/shared/utils"), { recursive: true });
    const innerPath = path.join(rootDir, "src/shared/utils/inner.ts");
    writeFileSync(innerPath, 'export const inner = "INNER-V1";\n');

    const middlePath = path.join(rootDir, "src/shared/utils/middle.ts");
    writeFileSync(
      middlePath,
      `import { inner } from "./inner.ts";
export const middle = () => inner;
`,
    );

    writeFileSync(
      pagePath,
      `import { middle } from "../src/shared/utils/middle.ts";
export default function Page() { return middle(); }
`,
    );

    const importBundled = createBundledImporter({ rootDir });

    const first = (await importBundled(pagePath)) as PageModule;
    expect(first.default()).toBe("INNER-V1");

    // Edit the deepest leaf
    writeFileSync(innerPath, 'export const inner = "INNER-V2";\n');
    await new Promise((r) => setTimeout(r, 30));

    const second = (await importBundled(pagePath)) as PageModule;
    expect(second.default()).toBe("INNER-V2");
  });

  it("per-source GC: unlinks the previous bundle when a new one is built for the same entry", async () => {
    const importBundled = createBundledImporter({ rootDir });

    await importBundled(pagePath);
    await importBundled(pagePath);
    await importBundled(pagePath);

    const fs = await import("fs/promises");
    const cacheDir = path.join(rootDir, ".mandu/dev-cache/ssr");
    const entries = await fs.readdir(cacheDir);
    // After GC, only the most recent bundle for `pagePath` should remain on disk.
    // (Pre-GC behavior had ≥3 entries. With GC, exactly 1 directory per source.)
    expect(entries.length).toBe(1);
    const bundles = await fs.readdir(path.join(cacheDir, entries[0]!));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatch(/\.mjs$/);
  });

  it("per-source GC keeps separate entries for different source modules", async () => {
    // Add a second route entry — the GC should track them independently.
    const otherPagePath = path.join(rootDir, "app/other.ts");
    writeFileSync(
      otherPagePath,
      `import { getSubtitle } from "../src/server/i18n.ts";
export default function Other() { return getSubtitle() + "!"; }
`,
    );

    const importBundled = createBundledImporter({ rootDir });

    await importBundled(pagePath);
    await importBundled(otherPagePath);
    await importBundled(pagePath); // gc previous pagePath bundle, keep otherPagePath

    const fs = await import("fs/promises");
    const entries = await fs.readdir(path.join(rootDir, ".mandu/dev-cache/ssr"));
    // 2 bundles total: latest pagePath + otherPagePath
    expect(entries.length).toBe(2);
  });

  it("honors TypeScript path aliases (@/*) declared in tsconfig.json", async () => {
    // tsconfig with @/* → src/*
    writeFileSync(
      path.join(rootDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            paths: { "@/*": ["./src/*"] },
          },
        },
        null,
        2,
      ),
    );

    // Page imports via the alias instead of relative
    writeFileSync(
      pagePath,
      `import { getSubtitle } from "@/server/i18n";
export default function Page() { return getSubtitle(); }
`,
    );

    const importBundled = createBundledImporter({ rootDir });
    const first = (await importBundled(pagePath)) as PageModule;
    expect(first.default()).toBe("원본 텍스트");

    writeFileSync(sharedPath, 'export default { hero: { subtitle: "alias-updated" } };\n');
    await new Promise((r) => setTimeout(r, 30));

    const second = (await importBundled(pagePath)) as PageModule;
    // Reporter's exact case used @/* aliases in the demo apps — verify they propagate too.
    expect(second.default()).toBe("alias-updated");
  });

  it("preserves top-level metadata / generateMetadata exports through the bundle (#186 round-trip)", async () => {
    writeFileSync(
      pagePath,
      `import { getSubtitle } from "../src/server/i18n.ts";

export const metadata = {
  title: "Static Title",
  description: "Static description",
};

export async function generateMetadata({ params }) {
  return { title: \`Dynamic \${params.id ?? "none"}\` };
}

export default function Page() {
  return getSubtitle();
}
`,
    );

    const importBundled = createBundledImporter({ rootDir });
    const mod = await importBundled(pagePath);
    const m = mod as Record<string, unknown> & { metadata?: { title?: string; description?: string }; generateMetadata?: Function };

    expect(m.metadata).toBeDefined();
    expect(m.metadata!.title).toBe("Static Title");
    expect(m.metadata!.description).toBe("Static description");
    expect(typeof m.generateMetadata).toBe("function");
    const dynamic = await m.generateMetadata!({ params: { id: "42" } });
    expect((dynamic as { title: string }).title).toBe("Dynamic 42");
  });

  it("propagates Bun.build errors with a useful message", async () => {
    // Break shared.ts into invalid TS
    writeFileSync(sharedPath, "export default { broken: oops syntax error\n");

    const importBundled = createBundledImporter({ rootDir });

    let caught: Error | null = null;
    try {
      await importBundled(pagePath);
    } catch (err) {
      caught = err instanceof Error ? err : new Error(String(err));
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("Failed to bundle");
    expect(caught!.message).toContain(path.basename(pagePath));
  });

  it("invokes onError callback when provided", async () => {
    writeFileSync(sharedPath, "export default { broken: oops\n");

    let receivedPath = "";
    const importBundled = createBundledImporter({
      rootDir,
      onError: (modPath) => {
        receivedPath = modPath;
      },
    });

    await expect(importBundled(pagePath)).rejects.toThrow();
    expect(receivedPath).toBe(path.resolve(pagePath));
  });

  it("wipes stale bundles from a prior session on first call", async () => {
    const cacheDir = path.join(rootDir, ".mandu/dev-cache/ssr");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, "stale-1.mjs"), "// from a prior run");
    writeFileSync(path.join(cacheDir, "stale-2.mjs"), "// from a prior run");

    const importBundled = createBundledImporter({ rootDir });
    await importBundled(pagePath);

    const fs = await import("fs/promises");
    const entries = await fs.readdir(cacheDir);
    // The two stale files are gone; only the freshly-built bundle remains.
    expect(entries.some((e) => e.startsWith("stale-"))).toBe(false);
    expect(entries.length).toBe(1);
  });
});
