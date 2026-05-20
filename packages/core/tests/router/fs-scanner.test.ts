/**
 * FS Scanner Tests
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { scanRoutes, generateManifest } from "../../src/router";
import { generateRoutes } from "../../src/generator/generate";

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
      // scanTime is best-effort and may be 0ms on fast environments
      expect(result.stats.scanTime).toBeGreaterThanOrEqual(0);
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

  it("should detect hydration shell mismatch risk when page.tsx bridges island with null placeholder", async () => {
    const mismatchDir = join(import.meta.dir, "__test_hydration_mismatch_risk__");

    await mkdir(join(mismatchDir, "app"), { recursive: true });

    await writeFile(
      join(mismatchDir, "app/page.tsx"),
      `import HomePageIsland from "./page.island";
       export default function HomePage() {
         return (
           <main>
             <h1>SSR Shell</h1>
             {typeof HomePageIsland !== "undefined" && null}
           </main>
         );
       }`
    );

    await writeFile(
      join(mismatchDir, "app/page.island.tsx"),
      `"use client";
       export default function HomePageIsland() {
         return <div>Hydrated UI</div>;
       }`
    );

    try {
      const result = await scanRoutes(mismatchDir);
      expect(result.errors.some((e) => e.type === "hydration_shell_mismatch_risk")).toBe(true);
    } finally {
      await rm(mismatchDir, { recursive: true, force: true });
    }
  });

  it("should NOT report hydration mismatch when island is used normally without null bridge", async () => {
    const normalDir = join(import.meta.dir, "__test_hydration_normal__");

    await mkdir(join(normalDir, "app"), { recursive: true });

    await writeFile(
      join(normalDir, "app/page.tsx"),
      `import PageIsland from "./page.island";
       export default function Page() {
         return <PageIsland />;
       }`
    );

    await writeFile(
      join(normalDir, "app/page.island.tsx"),
      `"use client";
       export default function PageIsland() {
         return <div>Normal Island</div>;
       }`
    );

    try {
      const result = await scanRoutes(normalDir);
      expect(result.errors.some((e) => e.type === "hydration_shell_mismatch_risk")).toBe(false);
    } finally {
      await rm(normalDir, { recursive: true, force: true });
    }
  });

  it("should NOT report hydration mismatch when null bridge exists but no island import", async () => {
    const noIslandDir = join(import.meta.dir, "__test_hydration_no_island__");

    await mkdir(join(noIslandDir, "app"), { recursive: true });

    await writeFile(
      join(noIslandDir, "app/page.tsx"),
      `export default function Page() {
         return (
           <main>
             {typeof window !== "undefined" && null}
             <h1>Hello</h1>
           </main>
         );
       }`
    );

    try {
      const result = await scanRoutes(noIslandDir);
      expect(result.errors.some((e) => e.type === "hydration_shell_mismatch_risk")).toBe(false);
    } finally {
      await rm(noIslandDir, { recursive: true, force: true });
    }
  });

  it("should NOT false-positive when page imports island and has unrelated typeof guard", async () => {
    const fpDir = join(import.meta.dir, "__test_hydration_fp__");

    await mkdir(join(fpDir, "app"), { recursive: true });

    await writeFile(
      join(fpDir, "app/page.tsx"),
      `import PageIsland from "./page.island";
       export default function Page() {
         return (
           <main>
             {typeof window !== "undefined" && null}
             <PageIsland />
           </main>
         );
       }`
    );

    await writeFile(
      join(fpDir, "app/page.island.tsx"),
      `"use client";
       export default function PageIsland() {
         return <div>Island</div>;
       }`
    );

    try {
      const result = await scanRoutes(fpDir);
      expect(result.errors.some((e) => e.type === "hydration_shell_mismatch_risk")).toBe(false);
    } finally {
      await rm(fpDir, { recursive: true, force: true });
    }
  });

  it("should detect 'use client' directive in page files as clientModule", async () => {
    const useClientDir = join(import.meta.dir, "__test_use_client__");

    await mkdir(join(useClientDir, "app/chat"), { recursive: true });
    await mkdir(join(useClientDir, "app/static"), { recursive: true });

    // Page with "use client"
    await writeFile(
      join(useClientDir, "app/chat/page.tsx"),
      '"use client";\nexport default function Chat() { return <div>Chat</div>; }'
    );

    // Page without "use client"
    await writeFile(
      join(useClientDir, "app/static/page.tsx"),
      "export default function Static() { return <div>Static</div>; }"
    );

    try {
      const result = await scanRoutes(useClientDir);

      const chatRoute = result.routes.find((r) => r.pattern === "/chat");
      const staticRoute = result.routes.find((r) => r.pattern === "/static");

      // Chat page should have clientModule (itself)
      expect(chatRoute).toBeDefined();
      expect(chatRoute?.clientModule).toBeDefined();
      expect(chatRoute?.clientModule?.replace(/\\/g, "/")).toContain("chat/page.tsx");

      // Static page should NOT have clientModule
      expect(staticRoute).toBeDefined();
      expect(staticRoute?.clientModule).toBeUndefined();
    } finally {
      await rm(useClientDir, { recursive: true, force: true });
    }
  });

  it("should link a nested page that returns a default-imported .client component", async () => {
    const defaultClientDir = join(import.meta.dir, "__test_default_client_import__");

    await mkdir(join(defaultClientDir, "app/login"), { recursive: true });
    await mkdir(join(defaultClientDir, "src/client/pages/login"), { recursive: true });

    await writeFile(
      join(defaultClientDir, "app/login/page.tsx"),
      `import LoginPage from "@/client/pages/login/LoginPage.client";

       export const metadata = { title: "Login" };

       export default function Page() {
         return <LoginPage />;
       }`
    );

    await writeFile(
      join(defaultClientDir, "src/client/pages/login/LoginPage.client.tsx"),
      `"use client";
       export default function LoginPage() {
         return <form><button>Login</button></form>;
       }`
    );

    try {
      const result = await generateManifest(defaultClientDir, {});
      const loginRoute = result.manifest.routes.find((r) => r.pattern === "/login");

      expect(loginRoute).toBeDefined();
      expect(loginRoute?.clientModule).toBe("src/client/pages/login/LoginPage.client.tsx");
      expect(loginRoute?.hydration?.strategy).toBe("island");

      const generated = await generateRoutes(result.manifest, defaultClientDir);
      expect(generated.success).toBe(true);

      const generatedRoute = await readFile(
        join(defaultClientDir, ".mandu/generated/web/routes/login.route.tsx"),
        "utf-8",
      );
      expect(generatedRoute).toContain("Page Module: app/login/page.tsx");
      expect(generatedRoute).toContain("Client Module: src/client/pages/login/LoginPage.client.tsx");
      expect(generatedRoute).toContain("React.createElement(pageModule");
      expect(generatedRoute).not.toContain("Login Page");
    } finally {
      await rm(defaultClientDir, { recursive: true, force: true });
    }
  });

  it("links a page fragment wrapper that renders a default-imported .client component", async () => {
    const fragmentDir = join(import.meta.dir, "__test_fragment_client_import__");

    await mkdir(join(fragmentDir, "app"), { recursive: true });
    await mkdir(join(fragmentDir, "src/client/pages/home"), { recursive: true });

    await writeFile(
      join(fragmentDir, "app/page.tsx"),
      `import HomeApp from "@/client/pages/home/HomeApp.client";

       export const metadata = { title: "Home" };

       export default function HomePage() {
         return <>
           <meta name="x" content="y" />
           <HomeApp />
         </>;
       }`
    );

    await writeFile(
      join(fragmentDir, "src/client/pages/home/HomeApp.client.tsx"),
      `"use client";
       export default function HomeApp() {
         return <main>Home</main>;
       }`
    );

    try {
      const result = await generateManifest(fragmentDir, {});
      const homeRoute = result.manifest.routes.find((r) => r.pattern === "/");

      expect(homeRoute).toBeDefined();
      expect(homeRoute?.clientModule).toBe("src/client/pages/home/HomeApp.client.tsx");
      expect(homeRoute?.hydration?.strategy).toBe("island");
    } finally {
      await rm(fragmentDir, { recursive: true, force: true });
    }
  });

  it("links a server shell page that renders named .client imports", async () => {
    const namedClientDir = join(import.meta.dir, "__test_named_client_import__");

    await mkdir(join(namedClientDir, "app/notifications"), { recursive: true });
    await mkdir(join(namedClientDir, "src/client/pages/notifications"), { recursive: true });
    await mkdir(join(namedClientDir, "src/client/widgets/bell"), { recursive: true });

    await writeFile(
      join(namedClientDir, "app/notifications/page.tsx"),
      `import { NotificationsPage } from "@/client/pages/notifications/NotificationsPage.client";
       import { NotificationBell } from "@/client/widgets/bell/NotificationBell.client";

       export default async function Page() {
         const title = await Promise.resolve("Notifications");
         return (
           <main>
             <h1>{title}</h1>
             <NotificationBell count={2} />
             <NotificationsPage />
           </main>
         );
       }`
    );

    await writeFile(
      join(namedClientDir, "src/client/pages/notifications/NotificationsPage.client.tsx"),
      `"use client";
       export function NotificationsPage() {
         return <section>Notifications</section>;
       }`
    );

    await writeFile(
      join(namedClientDir, "src/client/widgets/bell/NotificationBell.client.tsx"),
      `"use client";
       export function NotificationBell({ count }: { count: number }) {
         return <button>{count}</button>;
       }`
    );

    try {
      const result = await generateManifest(namedClientDir, {});
      const notificationsRoute = result.manifest.routes.find((r) => r.pattern === "/notifications");

      expect(notificationsRoute).toBeDefined();
      expect(notificationsRoute?.clientModule).toBe("src/client/pages/notifications/NotificationsPage.client.tsx");
      expect(notificationsRoute?.hydration?.strategy).toBe("island");
    } finally {
      await rm(namedClientDir, { recursive: true, force: true });
    }
  });

  it("links a page that renders a use-client component whose filename has no .client suffix", async () => {
    const useClientImportDir = join(import.meta.dir, "__test_use_client_import__");

    await mkdir(join(useClientImportDir, "app/pledges/new"), { recursive: true });
    await mkdir(join(useClientImportDir, "src/client/widgets/pledge-form"), { recursive: true });

    await writeFile(
      join(useClientImportDir, "app/pledges/new/page.tsx"),
      `import { PledgeForm } from "@/client/widgets/pledge-form/PledgeForm";

       export default async function NewPledgePage() {
         const data = await Promise.resolve([]);
         return <main><PledgeForm parties={data} candidates={data} /></main>;
       }`
    );

    await writeFile(
      join(useClientImportDir, "src/client/widgets/pledge-form/PledgeForm.tsx"),
      `"use client";
       export function PledgeForm() {
         return <form />;
       }`
    );

    try {
      const result = await generateManifest(useClientImportDir, {});
      const pledgeRoute = result.manifest.routes.find((r) => r.pattern === "/pledges/new");

      expect(pledgeRoute).toBeDefined();
      expect(pledgeRoute?.clientModule).toBe("src/client/widgets/pledge-form/PledgeForm.tsx");
      expect(pledgeRoute?.hydration?.strategy).toBe("island");
    } finally {
      await rm(useClientImportDir, { recursive: true, force: true });
    }
  });

  it("should not preserve stale page.tsx clientModule after page becomes server-only", async () => {
    const staleDir = join(import.meta.dir, "__test_stale_client_module__");

    await mkdir(join(staleDir, "app"), { recursive: true });
    await writeFile(
      join(staleDir, "app/page.tsx"),
      '"use client";\nexport default function Home() { return <button>Open</button>; }'
    );

    try {
      const first = await generateManifest(staleDir, {});
      const firstRoute = first.manifest.routes.find((r) => r.pattern === "/");
      expect(firstRoute?.clientModule?.replace(/\\/g, "/")).toBe("app/page.tsx");

      await writeFile(
        join(staleDir, "app/page.tsx"),
        'export default async function Home() { return <main>Server data</main>; }'
      );

      const second = await generateManifest(staleDir, {});
      const secondRoute = second.manifest.routes.find((r) => r.pattern === "/");
      expect(secondRoute?.clientModule).toBeUndefined();
    } finally {
      await rm(staleDir, { recursive: true, force: true });
    }
  });
});
