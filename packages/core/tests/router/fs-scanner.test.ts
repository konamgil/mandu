/**
 * FS Scanner Tests
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { scanRoutes, generateManifest } from "../../src/router";

// 테스트용 임시 디렉토리
const TEST_DIR = join(import.meta.dir, "__test_app__");

describe("FSScanner", () => {
  beforeAll(async () => {
    // 테스트 디렉토리 구조 생성
    await mkdir(join(TEST_DIR, "app"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/blog/[slug]"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/(marketing)/pricing"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/_components"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/docs/[[...path]]"), { recursive: true });

    // 파일 생성
    await writeFile(
      join(TEST_DIR, "app/page.tsx"),
      "export default function Home() { return <div>Home</div>; }"
    );

    await writeFile(
      join(TEST_DIR, "app/layout.tsx"),
      "export default function RootLayout({ children }) { return <html>{children}</html>; }"
    );

    await writeFile(
      join(TEST_DIR, "app/blog/page.tsx"),
      "export default function Blog() { return <div>Blog</div>; }"
    );

    await writeFile(
      join(TEST_DIR, "app/blog/[slug]/page.tsx"),
      "export default function BlogPost({ params }) { return <div>Post: {params.slug}</div>; }"
    );

    await writeFile(
      join(TEST_DIR, "app/blog/[slug]/comments.island.tsx"),
      "export default function Comments() { return <div>Comments</div>; }"
    );

    await writeFile(
      join(TEST_DIR, "app/api/users/route.ts"),
      "export const GET = () => Response.json({ users: [] });"
    );

    await writeFile(
      join(TEST_DIR, "app/(marketing)/pricing/page.tsx"),
      "export default function Pricing() { return <div>Pricing</div>; }"
    );

    await writeFile(
      join(TEST_DIR, "app/docs/[[...path]]/page.tsx"),
      "export default function Docs() { return <div>Docs</div>; }"
    );

    // 비공개 폴더 내 파일 (스캔되지 않아야 함)
    await writeFile(
      join(TEST_DIR, "app/_components/Button.tsx"),
      "export default function Button() { return <button>Click</button>; }"
    );
  });

  afterAll(async () => {
    // 테스트 디렉토리 정리
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("scanRoutes", () => {
    it("should scan all route files", async () => {
      const result = await scanRoutes(TEST_DIR);

      expect(result.errors).toHaveLength(0);
      expect(result.files.length).toBeGreaterThan(0);
    });

    it("should detect page files", async () => {
      const result = await scanRoutes(TEST_DIR);

      const pageFiles = result.files.filter((f) => f.type === "page");
      expect(pageFiles.length).toBeGreaterThanOrEqual(4); // home, blog, blog/[slug], pricing
    });

    it("should detect API route files", async () => {
      const result = await scanRoutes(TEST_DIR);

      const routeFiles = result.files.filter((f) => f.type === "route");
      expect(routeFiles).toHaveLength(1);
      expect(routeFiles[0].relativePath).toContain("api/users");
    });

    it("should detect layout files", async () => {
      const result = await scanRoutes(TEST_DIR);

      const layoutFiles = result.files.filter((f) => f.type === "layout");
      expect(layoutFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect island files", async () => {
      const result = await scanRoutes(TEST_DIR);

      const islandFiles = result.files.filter((f) => f.type === "island");
      expect(islandFiles).toHaveLength(1);
      expect(islandFiles[0].relativePath).toContain("comments.island");
    });

    it("should skip private folders", async () => {
      const result = await scanRoutes(TEST_DIR);

      const privateFiles = result.files.filter((f) => f.relativePath.includes("_components"));
      expect(privateFiles).toHaveLength(0);
    });

    it("should generate routes with correct patterns", async () => {
      const result = await scanRoutes(TEST_DIR);

      // 홈 라우트
      const homeRoute = result.routes.find((r) => r.pattern === "/");
      expect(homeRoute).toBeDefined();
      expect(homeRoute?.kind).toBe("page");

      // 블로그 라우트
      const blogRoute = result.routes.find((r) => r.pattern === "/blog");
      expect(blogRoute).toBeDefined();

      // 동적 라우트
      const blogPostRoute = result.routes.find((r) => r.pattern === "/blog/:slug");
      expect(blogPostRoute).toBeDefined();
      expect(blogPostRoute?.clientModule).toBeDefined(); // Island 연결

      // API 라우트
      const apiRoute = result.routes.find((r) => r.pattern === "/api/users");
      expect(apiRoute).toBeDefined();
      expect(apiRoute?.kind).toBe("api");

      // 그룹 라우트 (URL에서 그룹 제외)
      const pricingRoute = result.routes.find((r) => r.pattern === "/pricing");
      expect(pricingRoute).toBeDefined();

      // Optional catch-all 라우트
      const docsRoute = result.routes.find((r) => r.pattern === "/docs/:path*?");
      expect(docsRoute).toBeDefined();
    });

    it("should include root layout in layoutChain", async () => {
      const result = await scanRoutes(TEST_DIR);

      const homeRoute = result.routes.find((r) => r.pattern === "/");
      expect(homeRoute).toBeDefined();

      const chain = (homeRoute?.layoutChain || []).map((p) => p.replace(/\\/g, "/"));
      expect(chain).toContain("app/layout.tsx");
    });

    it("should calculate correct stats", async () => {
      const result = await scanRoutes(TEST_DIR);

      expect(result.stats.pageCount).toBeGreaterThanOrEqual(4);
      expect(result.stats.apiCount).toBe(1);
      expect(result.stats.layoutCount).toBeGreaterThanOrEqual(1);
      expect(result.stats.islandCount).toBe(1);
      expect(result.stats.scanTime).toBeGreaterThan(0);
    });
  });

  describe("generateManifest", () => {
    it("should generate valid manifest", async () => {
      const result = await generateManifest(TEST_DIR, {});

      expect(result.manifest.version).toBe(1);
      expect(result.manifest.routes.length).toBeGreaterThan(0);
      expect(result.fsRoutesCount).toBeGreaterThan(0);
    });

    it("should have unique route IDs", async () => {
      const result = await generateManifest(TEST_DIR, {});

      const ids = result.manifest.routes.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it("should have unique patterns", async () => {
      const result = await generateManifest(TEST_DIR, {});

      const patterns = result.manifest.routes.map((r) => r.pattern);
      const uniquePatterns = new Set(patterns);
      expect(patterns.length).toBe(uniquePatterns.size);
    });
  });

  it("should detect param name conflicts", async () => {
    const conflictDir = join(import.meta.dir, "__test_conflict__");

    await mkdir(join(conflictDir, "app/blog/[id]"), { recursive: true });
    await mkdir(join(conflictDir, "app/blog/[slug]"), { recursive: true });

    await writeFile(
      join(conflictDir, "app/blog/[id]/page.tsx"),
      "export default function PostById() { return <div>ById</div>; }"
    );

    await writeFile(
      join(conflictDir, "app/blog/[slug]/page.tsx"),
      "export default function PostBySlug() { return <div>BySlug</div>; }"
    );

    try {
      const result = await scanRoutes(conflictDir);

      expect(result.errors.some((e) => e.type === "pattern_conflict")).toBe(true);

      const dynamicBlogRoutes = result.routes.filter((r) => r.pattern.startsWith("/blog/:"));
      expect(dynamicBlogRoutes).toHaveLength(1);
    } finally {
      await rm(conflictDir, { recursive: true, force: true });
    }
  });
});
