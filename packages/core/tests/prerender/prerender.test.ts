/**
 * Prerender Engine Tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { prerenderRoutes } from "../../src/bundler/prerender";
import type { RoutesManifest } from "../../src/spec/schema";

let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-prerender-"));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    { kind: "page", id: "index", pattern: "/", module: "app/page.tsx", componentModule: "app/page.tsx" },
    { kind: "page", id: "about", pattern: "/about", module: "app/about/page.tsx", componentModule: "app/about/page.tsx" },
    { kind: "page", id: "blog-slug", pattern: "/blog/:slug", module: "app/blog/[slug]/page.tsx", componentModule: "app/blog/[slug]/page.tsx" },
  ],
};

function createFetchHandler(extraLinks: Record<string, string[]> = {}) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    const links = extraLinks[pathname] ?? [];
    const linkHtml = links.map((l) => `<a href="${l}">link</a>`).join("");
    const html = `<!DOCTYPE html><html><body><h1>Page: ${pathname}</h1>${linkHtml}</body></html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };
}

describe("prerenderRoutes", () => {
  it("renders static routes and writes output files", async () => {
    const root = await makeTmpDir();
    const outDir = path.join(root, "static");

    const result = await prerenderRoutes(manifest, createFetchHandler(), {
      rootDir: root,
      outDir,
    });

    // Two static routes: / and /about (dynamic /blog/:slug excluded)
    expect(result.generated).toBe(2);
    expect(result.errors).toHaveLength(0);

    const indexPath = path.join(outDir, "index.html");
    const aboutPath = path.join(outDir, "about", "index.html");

    const indexHtml = await fs.readFile(indexPath, "utf-8");
    const aboutHtml = await fs.readFile(aboutPath, "utf-8");

    expect(indexHtml).toContain("Page: /");
    expect(aboutHtml).toContain("Page: /about");
  });

  it("reports size and duration for each rendered page", async () => {
    const root = await makeTmpDir();

    const result = await prerenderRoutes(manifest, createFetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "static"),
    });

    for (const page of result.pages) {
      expect(page.size).toBeGreaterThan(0);
      expect(page.duration).toBeGreaterThanOrEqual(0);
      expect(typeof page.path).toBe("string");
    }
  });

  it("records error for non-200 responses", async () => {
    const root = await makeTmpDir();
    const failHandler = async () => new Response("Not Found", { status: 404 });

    const result = await prerenderRoutes(manifest, failHandler, {
      rootDir: root,
      outDir: path.join(root, "static"),
    });

    expect(result.generated).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("404");
  });

  it("crawl=true discovers internal links from rendered HTML", async () => {
    const root = await makeTmpDir();
    const outDir = path.join(root, "static");

    // The "/" page links to "/contact" which is not in the manifest
    const handler = createFetchHandler({ "/": ["/contact"] });

    const result = await prerenderRoutes(manifest, handler, {
      rootDir: root,
      outDir,
      crawl: true,
    });

    // Should render /, /about, and discovered /contact
    expect(result.generated).toBe(3);

    const contactPath = path.join(outDir, "contact", "index.html");
    const contactHtml = await fs.readFile(contactPath, "utf-8");
    expect(contactHtml).toContain("Page: /contact");
  });

  it("crawl=false does not follow links", async () => {
    const root = await makeTmpDir();
    const handler = createFetchHandler({ "/": ["/contact"] });

    const result = await prerenderRoutes(manifest, handler, {
      rootDir: root,
      outDir: path.join(root, "static"),
      crawl: false,
    });

    // Only the two static routes, /contact not discovered
    expect(result.generated).toBe(2);
    const paths = result.pages.map((p) => p.path);
    expect(paths).not.toContain("/contact");
  });

  it("does not render the same path twice", async () => {
    const root = await makeTmpDir();
    // Both / and /about link to each other
    const handler = createFetchHandler({
      "/": ["/about"],
      "/about": ["/"],
    });

    const result = await prerenderRoutes(manifest, handler, {
      rootDir: root,
      outDir: path.join(root, "static"),
      crawl: true,
    });

    expect(result.generated).toBe(2);
  });
});
