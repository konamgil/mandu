import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extract } from "../src/extractor";
import type { ExtractInput, InteractionGraph } from "../src/types";
import { readJson } from "../src/fs";

describe("extractor", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-extractor-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should extract route from simple page.tsx", async () => {
    // Setup
    const appDir = join(testDir, "app");
    mkdirSync(appDir, { recursive: true });

    const pageContent = `
      export default function HomePage() {
        return <div>Home</div>;
      }
    `;
    writeFileSync(join(appDir, "page.tsx"), pageContent);

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["app/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.summary.nodes).toBe(1);

    const graph: InteractionGraph = readJson(result.graphPath);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].kind).toBe("route");
    expect(graph.nodes[0].id).toBe("/");
  });

  test("should extract navigate edge from Link href", async () => {
    // Setup
    const appDir = join(testDir, "extract-link");
    mkdirSync(appDir, { recursive: true });

    const pageContent = `
      import Link from "next/link";

      export default function HomePage() {
        return (
          <div>
            <Link href="/about">About</Link>
          </div>
        );
      }
    `;
    writeFileSync(join(appDir, "page.tsx"), pageContent);

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["extract-link/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    expect(result.summary.edges).toBeGreaterThan(0);

    const navigateEdge = graph.edges.find((e) => e.kind === "navigate");
    expect(navigateEdge).toBeDefined();
    expect(navigateEdge?.kind).toBe("navigate");
    if (navigateEdge?.kind === "navigate") {
      expect(navigateEdge.to).toBe("/about");
    }
  });

  test("should extract navigate from mandu.navigate call", async () => {
    // Setup
    const appDir = join(testDir, "extract-navigate");
    mkdirSync(appDir, { recursive: true });

    const pageContent = `
      import { mandu } from "@mandujs/core";

      export default function HomePage() {
        const handleClick = () => {
          mandu.navigate("/dashboard");
        };

        return <button onClick={handleClick}>Go</button>;
      }
    `;
    writeFileSync(join(appDir, "page.tsx"), pageContent);

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["extract-navigate/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    const navigateEdge = graph.edges.find(
      (e) => e.kind === "navigate" && e.source === "mandu.navigate"
    );
    expect(navigateEdge).toBeDefined();
    if (navigateEdge?.kind === "navigate") {
      expect(navigateEdge.to).toBe("/dashboard");
    }
  });

  test("should extract openModal edge", async () => {
    // Setup
    const appDir = join(testDir, "extract-modal");
    mkdirSync(appDir, { recursive: true });

    const pageContent = `
      import { mandu } from "@mandujs/core";

      export default function SettingsPage() {
        const openConfirm = () => {
          mandu.modal.open("confirm-delete");
        };

        return <button onClick={openConfirm}>Delete</button>;
      }
    `;
    writeFileSync(join(appDir, "page.tsx"), pageContent);

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["extract-modal/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    const modalEdge = graph.edges.find((e) => e.kind === "openModal");
    expect(modalEdge).toBeDefined();
    expect(modalEdge?.kind).toBe("openModal");
    if (modalEdge?.kind === "openModal") {
      expect(modalEdge.modal).toBe("confirm-delete");
    }
  });

  test("should extract runAction edge", async () => {
    // Setup
    const appDir = join(testDir, "extract-action");
    mkdirSync(appDir, { recursive: true });

    const pageContent = `
      import { mandu } from "@mandujs/core";

      export default function LoginPage() {
        const handleLogin = async () => {
          await mandu.action.run("user.login");
        };

        return <button onClick={handleLogin}>Login</button>;
      }
    `;
    writeFileSync(join(appDir, "page.tsx"), pageContent);

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["extract-action/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    const actionEdge = graph.edges.find((e) => e.kind === "runAction");
    expect(actionEdge).toBeDefined();
    expect(actionEdge?.kind).toBe("runAction");
    if (actionEdge?.kind === "runAction") {
      expect(actionEdge.action).toBe("user.login");
    }
  });

  test("should handle empty file gracefully", async () => {
    // Setup
    const appDir = join(testDir, "empty");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, "page.tsx"), "");

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["empty/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert - should still create route node for empty file
    expect(result.ok).toBe(true);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });

  test("should handle multiple routes and edges", async () => {
    // Setup
    const baseDir = join(testDir, "multi-routes");
    mkdirSync(join(baseDir, "app"), { recursive: true });
    mkdirSync(join(baseDir, "app", "about"), { recursive: true });
    mkdirSync(join(baseDir, "app", "contact"), { recursive: true });

    writeFileSync(
      join(baseDir, "app", "page.tsx"),
      `
      import Link from "next/link";
      export default function Home() {
        return (
          <>
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
          </>
        );
      }
      `
    );

    writeFileSync(
      join(baseDir, "app", "about", "page.tsx"),
      `
      import Link from "next/link";
      export default function About() {
        return <Link href="/">Home</Link>;
      }
      `
    );

    writeFileSync(
      join(baseDir, "app", "contact", "page.tsx"),
      `export default function Contact() { return <div>Contact</div>; }`
    );

    // Execute
    const input: ExtractInput = {
      repoRoot: baseDir,
      routeGlobs: ["app/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    expect(graph.nodes).toHaveLength(3);
    expect(graph.stats.routes).toBe(3);
    expect(graph.edges.length).toBeGreaterThan(0);

    const routeIds = graph.nodes
      .filter((n) => n.kind === "route")
      .map((n) => n.id);
    expect(routeIds).toContain("/");
    expect(routeIds).toContain("/about");
    expect(routeIds).toContain("/contact");
  });

  test("should normalize route paths correctly", async () => {
    // Setup
    const baseDir = join(testDir, "normalize-routes");
    mkdirSync(join(baseDir, "app", "admin", "users"), { recursive: true });

    writeFileSync(
      join(baseDir, "app", "admin", "users", "page.tsx"),
      `export default function AdminUsers() { return <div>Users</div>; }`
    );

    // Execute
    const input: ExtractInput = {
      repoRoot: baseDir,
      routeGlobs: ["app/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    const routeNode = graph.nodes.find((n) => n.kind === "route");
    expect(routeNode).toBeDefined();
    expect(routeNode?.id).toBe("/admin/users");
  });

  test("should use custom routeGlobs", async () => {
    // Setup
    const baseDir = join(testDir, "custom-globs");
    mkdirSync(join(baseDir, "routes", "dashboard"), { recursive: true });

    writeFileSync(
      join(baseDir, "routes", "dashboard", "page.tsx"),
      `export default function Dashboard() { return <div>Dashboard</div>; }`
    );

    // Execute
    const input: ExtractInput = {
      repoRoot: baseDir,
      routeGlobs: ["routes/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    expect(graph.nodes).toHaveLength(1);
    const routeNode = graph.nodes[0];
    expect(routeNode.kind).toBe("route");
    expect(routeNode.id).toBe("/dashboard");
  });

  test("should set buildSalt correctly", async () => {
    // Setup
    const appDir = join(testDir, "build-salt");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, "page.tsx"), `export default function() {}`);

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["build-salt/**/page.tsx"],
      buildSalt: "production-123",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    expect(graph.buildSalt).toBe("production-123");
  });

  test("should ignore node_modules and .mandu directories", async () => {
    // Setup
    const baseDir = join(testDir, "ignore-dirs");
    mkdirSync(join(baseDir, "app"), { recursive: true });
    mkdirSync(join(baseDir, "node_modules", "some-package"), { recursive: true });
    mkdirSync(join(baseDir, ".mandu", "generated"), { recursive: true });

    writeFileSync(
      join(baseDir, "app", "page.tsx"),
      `export default function() { return <div>App</div>; }`
    );
    writeFileSync(
      join(baseDir, "node_modules", "some-package", "page.tsx"),
      `export default function() { return <div>Package</div>; }`
    );
    writeFileSync(
      join(baseDir, ".mandu", "generated", "page.tsx"),
      `export default function() { return <div>Generated</div>; }`
    );

    // Execute
    const input: ExtractInput = {
      repoRoot: baseDir,
      routeGlobs: ["**/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert - should only find app/page.tsx
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].file).toContain("app");
    expect(graph.nodes[0].file).not.toContain("node_modules");
    expect(graph.nodes[0].file).not.toContain(".mandu");
  });

  test("should extract ManduLink 'to' attribute", async () => {
    // Setup
    const appDir = join(testDir, "mandu-link");
    mkdirSync(appDir, { recursive: true });

    const pageContent = `
      import { ManduLink } from "@mandujs/core";

      export default function Page() {
        return <ManduLink to="/profile">Profile</ManduLink>;
      }
    `;
    writeFileSync(join(appDir, "page.tsx"), pageContent);

    // Execute
    const input: ExtractInput = {
      repoRoot: testDir,
      routeGlobs: ["mandu-link/**/page.tsx"],
      buildSalt: "test",
    };

    const result = await extract(input);
    const graph: InteractionGraph = readJson(result.graphPath);

    // Assert
    const navigateEdge = graph.edges.find(
      (e) => e.kind === "navigate" && e.source === "<jsx to>"
    );
    expect(navigateEdge).toBeDefined();
    if (navigateEdge?.kind === "navigate") {
      expect(navigateEdge.to).toBe("/profile");
    }
  });
});
