/**
 * Adapter tests — covers every bundled adapter's `check()` + `prepare()`
 * via isolated tmp-directory projects (Phase 13.1).
 *
 * The tests don't spawn any external CLI: `check()` only probes the
 * provider when `execute === true`, and `deploy()` requires an injected
 * `deployImpl` stub.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  cfPagesAdapter,
  createCfPagesAdapter,
  createFlyAdapter,
  createNetlifyAdapter,
  createRailwayAdapter,
  createVercelAdapter,
  dockerAdapter,
  dockerComposeAdapter,
  flyAdapter,
  netlifyAdapter,
  railwayAdapter,
  renderCfPagesWrangler,
  renderDockerCompose,
  renderDockerfile,
  renderEnvExample,
  renderFlyToml,
  renderNetlifySsrFunction,
  renderNetlifyToml,
  renderNixpacksToml,
  renderRailwayJson,
  renderVercelJson,
  vercelAdapter,
} from "../adapters";
import type { ProjectContext } from "../types";

async function makeProject(prefix: string): Promise<ProjectContext & { root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mandu-adapter-${prefix}-`));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "acme-app", version: "0.0.1" }, null, 2)
  );
  // Minimal ValidatedManduConfig — schema parse happens in dispatcher,
  // the adapters consume only a handful of fields.
  const config = {
    server: { port: 3333 },
    guard: {},
    build: {},
    dev: {},
    fsRoutes: {},
    seo: {},
  } as unknown as ProjectContext["config"];
  return {
    root,
    rootDir: root,
    config,
    projectName: "acme-app",
    hasPublicDir: false,
    hasTailwind: false,
  };
}

async function cleanup(project: { root: string }): Promise<void> {
  await fs.rm(project.root, { recursive: true, force: true });
}

// ===== templates ======================================================

describe("template renderers", () => {
  it("Dockerfile includes multi-stage base/deps/build/runtime", () => {
    const content = renderDockerfile({ hasLockfile: true });
    expect(content).toContain("ARG BUN_IMAGE=oven/bun:1.3.14-alpine");
    expect(content).toContain("FROM ${BUN_IMAGE} AS base");
    expect(content).toContain("AS deps");
    expect(content).toContain("AS build");
    expect(content).toContain("AS runtime");
    expect(content).toContain("EXPOSE 3333");
    expect(content).toContain(`CMD ["bun", "run", "mandu", "start"]`);
  });

  it("fly.toml validates app name format", () => {
    expect(() => renderFlyToml({ appName: "UPPER-CASE" })).toThrow(/invalid/);
    expect(() => renderFlyToml({ appName: "has spaces" })).toThrow(/invalid/);
    const ok = renderFlyToml({ appName: "valid-name" });
    expect(ok).toContain(`app = "valid-name"`);
    expect(ok).toContain(`primary_region = "nrt"`);
    expect(ok).toContain(`internal_port = 3333`);
  });

  it("vercel.json rejects obvious credential strings in env", () => {
    expect(() =>
      renderVercelJson({
        projectName: "acme",
        env: { API_KEY: "sk_TEST_FIXTURE_DO_NOT_USE" },
      })
    ).toThrow(/secret/i);
  });

  it("vercel.json scaffolds a static-only deploy (Issue #248)", () => {
    const content = renderVercelJson({ projectName: "acme" });
    const parsed = JSON.parse(content);
    // Static deploy → no `functions` block, no SSR rewrite. The flat
    // `dist/` tree from `mandu build --static` is served directly.
    expect(parsed.functions).toBeUndefined();
    expect(parsed.rewrites).toBeUndefined();
    expect(parsed.outputDirectory).toBe("dist");
    expect(parsed.buildCommand).toBe("bun run mandu build --static");
    // Long-lived cache for hashed bundles preserved at /.mandu/client/...
    expect(parsed.headers[0].source).toBe("/.mandu/client/(.*)");
    expect(parsed.headers[0].headers[0].value).toMatch(/immutable/);
    // Deprecated `name` must not appear; project naming is owned by Vercel
    // project settings.
    expect(parsed.name).toBeUndefined();
  });

  it("railway.json + nixpacks.toml emit bun providers", () => {
    const rj = JSON.parse(renderRailwayJson({ projectName: "acme" }));
    expect(rj.build.builder).toBe("NIXPACKS");
    const nt = renderNixpacksToml();
    expect(nt).toContain(`providers = ["bun"]`);
    expect(nt).toContain(`BUN_VERSION = "1.3.14"`);
  });

  it("railway.json rejects lowercase env keys", () => {
    expect(() =>
      renderRailwayJson({
        projectName: "acme",
        env: { lower_case: "x" },
      })
    ).toThrow(/must match/);
  });

  it("netlify.toml wires the SSR catch-all redirect", () => {
    const content = renderNetlifyToml({ projectName: "acme" });
    expect(content).toContain(`from = "/*"`);
    expect(content).toContain(`to = "/.netlify/functions/ssr"`);
    expect(content).toContain(`NODE_VERSION = "20"`);
  });

  it("netlify SSR function template imports @mandujs/core", () => {
    expect(renderNetlifySsrFunction()).toContain("@mandujs/core");
  });

  it("cf-pages wrangler.toml enforces project slug format", () => {
    expect(() =>
      renderCfPagesWrangler({ projectName: "UPPER-case" })
    ).toThrow(/must match/);
    const ok = renderCfPagesWrangler({ projectName: "acme-pages" });
    expect(ok).toContain(`name = "acme-pages"`);
    expect(ok).toContain(`nodejs_compat`);
    expect(ok).toContain(`pages_build_output_dir`);
  });

  it("docker-compose scaffolds postgres sidecar + healthchecks", () => {
    const yaml = renderDockerCompose({ projectName: "acme" });
    expect(yaml).toContain("services:");
    expect(yaml).toContain("  app:");
    expect(yaml).toContain("  postgres:");
    expect(yaml).toContain("healthcheck:");
    expect(yaml).toContain("POSTGRES_PASSWORD");
  });

  it("docker-compose env example omits redis unless requested", () => {
    const no = renderEnvExample(true, false);
    expect(no).not.toContain("Redis");
    const yes = renderEnvExample(true, true);
    expect(yes).toContain("Redis");
  });

});

// ===== check() + prepare() ===========================================

describe("dockerAdapter", () => {
  it("check() fails without package.json", async () => {
    const p = await makeProject("docker-fail");
    await fs.unlink(path.join(p.root, "package.json"));
    const result = await dockerAdapter.check(p, { target: "docker" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("CLI_E201");
    await cleanup(p);
  });

  it("prepare() emits Dockerfile + .dockerignore", async () => {
    const p = await makeProject("docker-ok");
    const artifacts = await dockerAdapter.prepare(p, { target: "docker" });
    const paths = artifacts.map((a) => path.basename(a.path)).sort();
    expect(paths).toEqual([".dockerignore", "Dockerfile"]);
    const dockerfile = await fs.readFile(path.join(p.root, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("FROM");
    await cleanup(p);
  });
});

describe("flyAdapter", () => {
  it("check() fails when project name violates Fly constraints", async () => {
    const p = await makeProject("fly-bad-name");
    const result = await flyAdapter.check(p, {
      target: "fly",
      projectName: "UPPER-case",
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("CLI_E201");
    await cleanup(p);
  });

  it("check() probes flyctl when --execute", async () => {
    const p = await makeProject("fly-missing-cli");
    const adapter = createFlyAdapter({
      spawnImpl: async () => ({ stdout: "", stderr: "", exitCode: 127, notFound: true }),
    });
    const result = await adapter.check(p, {
      target: "fly",
      execute: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "CLI_E205")).toBe(true);
    await cleanup(p);
  });

  it("prepare() emits fly.toml + Dockerfile and preserves existing fly.toml", async () => {
    const p = await makeProject("fly-prepare");
    const artifacts1 = await flyAdapter.prepare(p, { target: "fly" });
    const paths = artifacts1.map((a) => path.basename(a.path)).sort();
    expect(paths).toEqual(["Dockerfile", "fly.toml"]);
    // Mutate fly.toml, re-run prepare, verify preservation.
    const flyToml = path.join(p.root, "fly.toml");
    await fs.writeFile(flyToml, "# user-modified\n");
    const artifacts2 = await flyAdapter.prepare(p, { target: "fly" });
    const flyArt = artifacts2.find((a) => a.path === flyToml);
    expect(flyArt?.preserved).toBe(true);
    expect(await fs.readFile(flyToml, "utf8")).toBe("# user-modified\n");
    await cleanup(p);
  });
});

describe("vercelAdapter", () => {
  it("check() surfaces edge-runtime style warnings only from netlify", async () => {
    const p = await makeProject("vercel-check");
    const result = await vercelAdapter.check(p, { target: "vercel", dryRun: true });
    expect(result.ok).toBe(true);
    await cleanup(p);
  });

  it("check() returns outdated error when CLI is old", async () => {
    const p = await makeProject("vercel-old");
    const adapter = createVercelAdapter({
      spawnImpl: async () => ({
        stdout: "Vercel CLI 27.5.0",
        stderr: "",
        exitCode: 0,
        notFound: false,
      }),
    });
    const result = await adapter.check(p, { target: "vercel", execute: true });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("CLI_E206");
    await cleanup(p);
  });

  it("prepare() emits vercel.json only — no SSR function (Issue #248)", async () => {
    const p = await makeProject("vercel-prepare");
    const artifacts = await vercelAdapter.prepare(p, { target: "vercel" });
    const rels = artifacts
      .map((a) => path.relative(p.root, a.path).replace(/\\/g, "/"))
      .sort();
    // Static-only scaffold — no api/*.ts is generated. Removing the
    // SSR entry was deliberate: no published Vercel function runtime
    // can host Mandu's startServer (see vercel.ts module docstring).
    expect(rels).toEqual(["vercel.json"]);
    const parsed = JSON.parse(
      await fs.readFile(path.join(p.root, "vercel.json"), "utf8")
    );
    expect(parsed.functions).toBeUndefined();
    expect(parsed.outputDirectory).toBe("dist");
    expect(parsed.name).toBeUndefined();
    await cleanup(p);
  });
});

describe("railwayAdapter", () => {
  it("check() reports missing railway CLI on --execute", async () => {
    const p = await makeProject("railway-nocli");
    const adapter = createRailwayAdapter({
      spawnImpl: async () => ({ stdout: "", stderr: "", exitCode: 127, notFound: true }),
    });
    const result = await adapter.check(p, { target: "railway", execute: true });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("CLI_E205");
    await cleanup(p);
  });

  it("prepare() emits railway.json + nixpacks.toml", async () => {
    const p = await makeProject("railway-prepare");
    const artifacts = await railwayAdapter.prepare(p, { target: "railway" });
    const files = artifacts.map((a) => path.basename(a.path)).sort();
    expect(files).toEqual(["nixpacks.toml", "railway.json"]);
    await cleanup(p);
  });
});

describe("netlifyAdapter", () => {
  it("check() always surfaces the Phase 15 edge warning", async () => {
    const p = await makeProject("netlify-check");
    const result = await netlifyAdapter.check(p, { target: "netlify" });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === "CLI_E213")).toBe(true);
    await cleanup(p);
  });

  it("prepare() emits netlify.toml + ssr function", async () => {
    const p = await makeProject("netlify-prepare");
    const artifacts = await netlifyAdapter.prepare(p, { target: "netlify" });
    const rels = artifacts
      .map((a) => path.relative(p.root, a.path).replace(/\\/g, "/"))
      .sort();
    expect(rels).toEqual(["netlify.toml", "netlify/functions/ssr.ts"]);
    await cleanup(p);
  });

  it("check() surfaces outdated netlify CLI on --execute", async () => {
    const p = await makeProject("netlify-old");
    const adapter = createNetlifyAdapter({
      spawnImpl: async () => ({
        stdout: "netlify-cli/16.5.0 darwin-arm64 node-v20.0.0",
        stderr: "",
        exitCode: 0,
        notFound: false,
      }),
    });
    const result = await adapter.check(p, { target: "netlify", execute: true });
    expect(result.errors.some((e) => e.code === "CLI_E206")).toBe(true);
    await cleanup(p);
  });
});

describe("cfPagesAdapter", () => {
  it("check() surfaces Phase 13 artifact-only warning every run", async () => {
    const p = await makeProject("cf-check");
    const result = await cfPagesAdapter.check(p, { target: "cf-pages" });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === "CLI_E213")).toBe(true);
    await cleanup(p);
  });

  it("prepare() scaffolds wrangler.toml + functions/_middleware.ts", async () => {
    const p = await makeProject("cf-prepare");
    const artifacts = await cfPagesAdapter.prepare(p, { target: "cf-pages" });
    const rels = artifacts
      .map((a) => path.relative(p.root, a.path).replace(/\\/g, "/"))
      .sort();
    expect(rels).toEqual(["functions/_middleware.ts", "wrangler.toml"]);
    await cleanup(p);
  });

  it("deploy() returns NOT_IMPLEMENTED without an injected harness", async () => {
    const p = await makeProject("cf-deploy-refuses");
    const adapter = createCfPagesAdapter();
    const result = await adapter.deploy!(p, { target: "cf-pages" });
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]?.code).toBe("CLI_E214");
    await cleanup(p);
  });
});

describe("dockerComposeAdapter", () => {
  it("prepare() emits compose + env example + Dockerfile", async () => {
    const p = await makeProject("compose-prepare");
    const artifacts = await dockerComposeAdapter.prepare(p, { target: "docker-compose" });
    const rels = artifacts
      .map((a) => path.basename(a.path))
      .sort();
    expect(rels).toEqual([".env.example", "Dockerfile", "docker-compose.yml"]);
    const yaml = await fs.readFile(path.join(p.root, "docker-compose.yml"), "utf8");
    expect(yaml).toContain("  app:");
    expect(yaml).toContain("  postgres:");
    await cleanup(p);
  });
});
