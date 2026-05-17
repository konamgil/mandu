/**
 * Issue #250 — Inference context builder tests.
 *
 * The context is the union of facts the heuristic and brain inferers
 * consume. Anything that mis-classifies here propagates downstream as
 * a wrong intent, so we pin both extraction and classification.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  buildDeployInferenceContext,
  classifyImports,
  classifySourceDependencies,
  extractImports,
  hashSource,
} from "../../../src/deploy/inference/context";
import type { RouteSpec } from "../../../src/spec/schema";

describe("extractImports", () => {
  it("extracts static imports", () => {
    const src = `
      import { foo } from "react";
      import bar from 'next';
      import "side-effect";
    `;
    expect(extractImports(src)).toEqual(["next", "react", "side-effect"]);
  });

  it("extracts dynamic imports", () => {
    const src = `const m = await import("openai");`;
    expect(extractImports(src)).toEqual(["openai"]);
  });

  it("ignores relative imports", () => {
    const src = `
      import { x } from "./local";
      import { y } from "../shared";
      import { z } from "external";
    `;
    expect(extractImports(src)).toEqual(["external"]);
  });

  it("dedupes mixed static + dynamic forms of the same specifier", () => {
    const src = `
      import { foo } from "shared";
      const m = await import("shared");
    `;
    expect(extractImports(src)).toEqual(["shared"]);
  });
});

describe("classifyImports", () => {
  it("flags database drivers", () => {
    const classes = classifyImports(["postgres"]);
    expect(classes.has("db")).toBe(true);
  });

  it("flags drizzle subpath imports", () => {
    expect(classifyImports(["drizzle-orm/postgres-js"]).has("db")).toBe(true);
  });

  it("flags bun:* primitives as bun-native", () => {
    const classes = classifyImports(["bun:sqlite"]);
    expect(classes.has("bun-native")).toBe(true);
  });

  it("flags node:fs as node-fs", () => {
    expect(classifyImports(["node:fs"]).has("node-fs")).toBe(true);
    expect(classifyImports(["fs/promises"]).has("node-fs")).toBe(true);
  });

  it("flags AI SDKs", () => {
    expect(classifyImports(["@anthropic-ai/sdk"]).has("ai-sdk")).toBe(true);
    expect(classifyImports(["openai"]).has("ai-sdk")).toBe(true);
  });

  it("falls back to fetch-only for plain libraries", () => {
    const classes = classifyImports(["zod", "react"]);
    expect(classes.has("fetch-only")).toBe(true);
    expect(classes.has("db")).toBe(false);
  });

  it("returns fetch-only when there are no imports at all", () => {
    expect(classifyImports([]).has("fetch-only")).toBe(true);
  });
});

describe("classifySourceDependencies", () => {
  it("flags local server/infra imports as database-backed", () => {
    const source = `import { db } from "@/server/infra/db";\nexport default db.query("select 1");`;
    const classes = classifySourceDependencies(source);
    expect(classes.has("db")).toBe(true);
    expect(classes.has("fetch-only")).toBe(false);
  });

  it("flags db tagged templates even when imports look edge-safe", () => {
    const source = `import { Mandu } from "@mandujs/core";\nexport default Mandu.filling().get(() => db\`select 1\`);`;
    const classes = classifySourceDependencies(source);
    expect(classes.has("db")).toBe(true);
    expect(classes.has("fetch-only")).toBe(false);
  });
});

describe("hashSource", () => {
  it("is deterministic", () => {
    expect(hashSource("hello")).toBe(hashSource("hello"));
  });

  it("differs when content differs", () => {
    expect(hashSource("a")).not.toBe(hashSource("b"));
  });

  it("handles empty input without throwing", () => {
    expect(hashSource("").length).toBe(64);
  });
});

describe("buildDeployInferenceContext", () => {
  let TEST_DIR: string;

  beforeEach(async () => {
    TEST_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-deploy-ctx-"));
    await fs.mkdir(path.join(TEST_DIR, "app", "api", "embed"), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, "app", "[lang]"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("builds context for a stateless API route", async () => {
    const file = path.join(TEST_DIR, "app", "api", "embed", "route.ts");
    await fs.writeFile(
      file,
      `import { Mandu } from "@mandujs/core";
export default Mandu.filling().post(async ({ ctx }) => Response.json({ ok: true }));
`,
    );
    const route: RouteSpec = {
      id: "api/embed",
      pattern: "/api/embed",
      module: path.relative(TEST_DIR, file),
      kind: "api",
    };
    const ctx = await buildDeployInferenceContext(TEST_DIR, route);
    expect(ctx.routeId).toBe("api/embed");
    expect(ctx.kind).toBe("api");
    expect(ctx.isDynamic).toBe(false);
    expect(ctx.exportsFilling).toBe(true);
    expect([...ctx.dependencyClasses]).toEqual(["fetch-only"]);
  });

  it("flags dynamic patterns", async () => {
    const file = path.join(TEST_DIR, "app", "[lang]", "page.tsx");
    await fs.writeFile(file, `export default function Page() { return null; }`);
    const route: RouteSpec = {
      id: "lang/page",
      pattern: "/[lang]",
      module: path.relative(TEST_DIR, file),
      kind: "page",
      componentModule: path.relative(TEST_DIR, file),
    };
    const ctx = await buildDeployInferenceContext(TEST_DIR, route);
    expect(ctx.isDynamic).toBe(true);
    expect(ctx.hasGenerateStaticParams).toBe(false);
  });

  it("recognises generateStaticParams via manifest field", async () => {
    const file = path.join(TEST_DIR, "app", "[lang]", "page.tsx");
    await fs.writeFile(file, `export default function Page() { return null; }`);
    const route: RouteSpec = {
      id: "lang/page",
      pattern: "/[lang]",
      module: path.relative(TEST_DIR, file),
      kind: "page",
      componentModule: path.relative(TEST_DIR, file),
      staticParams: [{ lang: "ko" }, { lang: "en" }],
    };
    const ctx = await buildDeployInferenceContext(TEST_DIR, route);
    expect(ctx.hasGenerateStaticParams).toBe(true);
  });

  it("classifies DB-importing API as 'db'", async () => {
    const file = path.join(TEST_DIR, "app", "api", "embed", "route.ts");
    await fs.writeFile(
      file,
      `import { drizzle } from "drizzle-orm/postgres-js";
export default async function POST() { return new Response(); }`,
    );
    const route: RouteSpec = {
      id: "api/embed",
      pattern: "/api/embed",
      module: path.relative(TEST_DIR, file),
      kind: "api",
    };
    const ctx = await buildDeployInferenceContext(TEST_DIR, route);
    expect(ctx.dependencyClasses.has("db")).toBe(true);
  });

  it("classifies server/infra DB API as server runtime material", async () => {
    const file = path.join(TEST_DIR, "app", "api", "embed", "route.ts");
    await fs.writeFile(
      file,
      `import { db } from "@/server/infra/db";
export default async function GET() { return Response.json(await db.query("select 1")); }
`,
    );
    const route: RouteSpec = {
      id: "api/embed",
      pattern: "/api/embed",
      module: path.relative(TEST_DIR, file),
      kind: "api",
    };
    const ctx = await buildDeployInferenceContext(TEST_DIR, route);
    expect(ctx.dependencyClasses.has("db")).toBe(true);
    expect(ctx.dependencyClasses.has("fetch-only")).toBe(false);
  });

  it("survives a missing module file", async () => {
    const route: RouteSpec = {
      id: "api/missing",
      pattern: "/api/missing",
      module: "app/api/missing/route.ts",
      kind: "api",
    };
    const ctx = await buildDeployInferenceContext(TEST_DIR, route);
    expect(ctx.imports).toEqual([]);
    expect(ctx.exportsFilling).toBe(false);
  });
});
