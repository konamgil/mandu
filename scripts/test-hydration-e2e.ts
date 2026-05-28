#!/usr/bin/env bun

import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { generateManifest } from "../packages/core/src/router/fs-routes";
import { buildClientBundles } from "../packages/core/src/bundler/build";
import {
  clearDefaultRegistry,
  registerManifestHandlers,
  startServer,
  type ManduServer,
} from "../packages/core/src/runtime";
import { createBundledImporter, type BundledImporter } from "../packages/cli/src/util/bun";

const repoRoot = path.resolve(import.meta.dir, "..");
const fixtureRoot = path.join(repoRoot, ".mandu", "tmp", "hydration-e2e");
const browserRunnerPath = path.join(repoRoot, "scripts", "test-hydration-e2e-browser.cjs");

interface TestServer {
  server: ManduServer;
  importer: BundledImporter;
}

function logStep(message: string): void {
  console.log(`[hydration-e2e] ${message}`);
}

async function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function cleanupWithTimeout(
  label: string,
  operation: Promise<unknown> | undefined,
  timeoutMs: number,
): Promise<void> {
  if (!operation) return;
  try {
    await withTimeout(label, operation.then(() => undefined), timeoutMs);
  } catch (error) {
    console.warn(`[hydration-e2e] ${label} did not finish cleanly: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resetFixture(): Promise<void> {
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, "app"), { recursive: true });
  for (const routeDir of [
    "async",
    "default",
    "interaction",
    "legacy-data-props",
    "route-data-fallback",
    "streaming",
    "hook",
  ]) {
    await mkdir(path.join(fixtureRoot, "app", routeDir), { recursive: true });
  }
  await mkdir(path.join(fixtureRoot, "src", "client"), { recursive: true });

  await writeFile(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify(
      {
        name: "mandu-hydration-e2e-fixture",
        type: "module",
        dependencies: {
          "@mandujs/core": "workspace:*",
          react: "^19.2.0",
          "react-dom": "^19.2.0",
        },
      },
      null,
      2,
    ) + "\n",
  );

  await writeFile(
    path.join(fixtureRoot, "app", "page.tsx"),
    `
import { Counter } from "../src/client/Counter.client";

export default function Page() {
  return (
    <main>
      <h1>Mandu hydration E2E</h1>
      <Counter
        label="Count"
        initial={2}
        complex={{
          date: new Date("2026-05-23T00:00:00.000Z"),
          map: new Map([
            ["count", 2],
            ["nested", { ok: true }],
          ]),
          set: new Set(["a", "b"]),
          url: new URL("https://mandu.dev/hydration?phase=4"),
          missing: undefined,
          nested: { list: [1, undefined, { value: "x" }] },
        }}
      />
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "app", "hook", "page.tsx"),
    `
import React, { useId } from "react";
import { Counter } from "../../src/client/Counter.client";

function HookedCounterWrapper() {
  const hookId = useId();

  return (
    <section data-e2e-hook-wrapper data-hook-id={hookId}>
      <Counter label="Hook Count" initial={7} hookId={hookId} />
    </section>
  );
}

export default function HookPage() {
  return (
    <main>
      <h1>Mandu hook wrapper hydration E2E</h1>
      <HookedCounterWrapper />
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "app", "default", "page.tsx"),
    `
import DefaultCounter from "../../src/client/DefaultCounter.client";

export default function DefaultExportPage() {
  return (
    <main>
      <h1>Default export client boundary</h1>
      <DefaultCounter label="Default Count" initial={3} />
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "app", "async", "page.tsx"),
    `
import { Counter } from "../../src/client/Counter.client";

async function AsyncCounterWrapper() {
  await Promise.resolve();
  return <Counter label="Async Count" initial={4} />;
}

export default async function AsyncPage() {
  const counter = await AsyncCounterWrapper();

  return (
    <main>
      <h1>Async wrapper client boundary</h1>
      {counter}
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "app", "interaction", "page.tsx"),
    `
import { Counter } from "../../src/client/Counter.client";

export const hydration = {
  strategy: "island",
  priority: "interaction",
  preload: false,
};

export default function InteractionPage() {
  return (
    <main data-e2e-interaction-target>
      <h1>Interaction client boundary</h1>
      <Counter label="Interaction Count" initial={5} />
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "app", "streaming", "page.tsx"),
    `
import { Counter } from "../../src/client/Counter.client";

export default function StreamingPage() {
  return (
    <main>
      <h1>Streaming client boundary</h1>
      <Counter label="Streaming Count" initial={6} />
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "app", "legacy-data-props", "page.tsx"),
    `
export default function LegacyDataPropsPage() {
  return (
    <main>
      <h1>Legacy data-props fallback</h1>
      <div
        data-mandu-island="legacy-data-props"
        data-mandu-src="/.mandu/client/legacy-data-props.raw.js"
        data-hydrate="load"
        data-mandu-priority="immediate"
        data-props={JSON.stringify({ label: "Legacy Props", initial: 8 })}
        style={{ display: "contents" }}
      />
      <script
        type="importmap"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            imports: {
              react: "/.mandu/client/_react.js",
              "react-dom/client": "/.mandu/client/_react-dom-client.js",
            },
          }),
        }}
      />
      <script type="module" src="/.mandu/client/_runtime.js" />
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "app", "route-data-fallback", "page.tsx"),
    `
export default function RouteDataFallbackPage() {
  return (
    <main>
      <h1>Route data fallback</h1>
      <div
        data-mandu-island="route-data-fallback-raw"
        data-mandu-route-id="route-data-fallback"
        data-mandu-src="/.mandu/client/route-data-fallback.raw.js"
        data-hydrate="load"
        data-mandu-priority="immediate"
        style={{ display: "contents" }}
      />
      <script
        type="importmap"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            imports: {
              react: "/.mandu/client/_react.js",
              "react-dom/client": "/.mandu/client/_react-dom-client.js",
            },
          }),
        }}
      />
      <script type="module" src="/.mandu/client/_runtime.js" />
    </main>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "src", "client", "Counter.client.tsx"),
    `
"use client";

import React, { useState } from "react";

export function Counter({
  label,
  initial,
  hookId,
  complex,
}: {
  label: string;
  initial: number;
  hookId?: string;
  complex?: {
    date?: Date;
    map?: Map<unknown, unknown>;
    set?: Set<unknown>;
    url?: URL;
    missing?: unknown;
    nested?: { list?: unknown[] };
  };
}) {
  const [count, setCount] = useState(initial);
  const complexOk = Boolean(
    complex &&
    complex.date instanceof Date &&
    complex.date.toISOString() === "2026-05-23T00:00:00.000Z" &&
    complex.map instanceof Map &&
    complex.map.get("count") === 2 &&
    complex.map.get("nested") &&
    typeof complex.map.get("nested") === "object" &&
    (complex.map.get("nested") as { ok?: unknown }).ok === true &&
    complex.set instanceof Set &&
    complex.set.has("a") &&
    complex.set.has("b") &&
    complex.url instanceof URL &&
    complex.url.href === "https://mandu.dev/hydration?phase=4" &&
    Object.prototype.hasOwnProperty.call(complex, "missing") &&
    complex.missing === undefined &&
    Array.isArray(complex.nested?.list) &&
    complex.nested.list[1] === undefined
  );

  return (
    <button
      type="button"
      data-e2e-counter
      data-count={count}
      data-hook-id={hookId ?? ""}
      data-complex-props={complex ? (complexOk ? "ok" : "bad") : ""}
      onClick={() => setCount((value) => value + 1)}
    >
      {label}: {count}
    </button>
  );
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, "src", "client", "DefaultCounter.client.tsx"),
    `
"use client";

export { Counter as default } from "./Counter.client";
`,
  );
}

function assertRouteBoundary(manifest: Awaited<ReturnType<typeof generateManifest>>["manifest"], routeId: string): void {
  const route = manifest.routes.find((candidate) => candidate.kind === "page" && candidate.id === routeId);
  if (!route || route.kind !== "page") {
    throw new Error(`Hydration E2E fixture did not generate the ${routeId} page route`);
  }
  if (!route.boundaries || route.boundaries.length !== 1) {
    throw new Error(`Expected exactly one compiler-owned client boundary for ${routeId}, got ${route.boundaries?.length ?? 0}`);
  }
}

async function createServer(): Promise<TestServer> {
  logStep("generate route manifest");
  const { manifest } = await generateManifest(fixtureRoot);
  for (const routeId of ["index", "hook", "default", "async", "interaction", "streaming"]) {
    assertRouteBoundary(manifest, routeId);
  }
  const streamingRoute = manifest.routes.find((route) => route.kind === "page" && route.id === "streaming");
  if (streamingRoute && streamingRoute.kind === "page") {
    streamingRoute.streaming = true;
  }

  logStep("build client bundles");
  const bundleResult = await buildClientBundles(manifest, fixtureRoot, {
    mode: "production",
    minify: false,
    sourcemap: false,
    splitting: false,
  });
  if (!bundleResult.success) {
    throw new Error(`Hydration E2E client bundle failed:\n${bundleResult.errors.join("\n")}`);
  }
  if (bundleResult.manifest.env !== "production" || bundleResult.manifest.shared.fastRefresh) {
    throw new Error("Hydration E2E expected a production client manifest without Fast Refresh runtime");
  }
  await writeRawRuntimeFallbackModules();

  clearDefaultRegistry();
  const importer = createBundledImporter({ rootDir: fixtureRoot });
  logStep("register manifest handlers");
  await registerManifestHandlers(manifest, fixtureRoot, {
    importFn: importer,
    registeredLayouts: new Set(),
  });

  logStep("start SSR server");
  return {
    importer,
    server: startServer(manifest, {
      port: 0,
      rootDir: fixtureRoot,
      bundleManifest: bundleResult.manifest,
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
      silent: true,
    }),
  };
}

async function writeRawRuntimeFallbackModules(): Promise<void> {
  const clientDir = path.join(fixtureRoot, ".mandu", "client");
  await mkdir(clientDir, { recursive: true });
  const moduleSource = (name: string) => `
import React, { useState } from "/.mandu/client/_react.js";

export default function ${name}({ label, initial }) {
  const [count, setCount] = useState(initial);
  return React.createElement(
    "button",
    {
      type: "button",
      "data-e2e-counter": "",
      "data-count": count,
      onClick: () => setCount((value) => value + 1),
    },
    label + ": " + count,
  );
}
`;
  await writeFile(
    path.join(clientDir, "legacy-data-props.raw.js"),
    moduleSource("LegacyDataPropsRaw"),
  );
  await writeFile(
    path.join(clientDir, "route-data-fallback.raw.js"),
    moduleSource("RouteDataFallbackRaw"),
  );
}

function resolveNodeExecutable(): string {
  return Bun.which("node") ?? (process.platform === "win32" ? "node.exe" : "node");
}

async function runBrowserAssertions(baseUrl: string): Promise<void> {
  const proc = Bun.spawn([resolveNodeExecutable(), browserRunnerPath, baseUrl], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 75_000);

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]).finally(() => clearTimeout(timer));

  if (stdout.trim()) {
    console.log(stdout.trim());
  }
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  if (timedOut) {
    throw new Error("Hydration E2E browser runner timed out after 75000ms");
  }
  if (exitCode !== 0) {
    throw new Error(`Hydration E2E browser runner exited with code ${exitCode}`);
  }
}

async function main(): Promise<void> {
  let testServer: TestServer | undefined;
  let cleanupFixture = true;

  try {
    logStep("reset fixture");
    await resetFixture();
    testServer = await withTimeout("create hydration E2E server", createServer(), 60_000);
    const port = testServer.server.server.port;
    if (!port) {
      throw new Error("Hydration E2E server did not expose a listening port");
    }

    logStep("run browser hydration assertions");
    await runBrowserAssertions(`http://127.0.0.1:${port}/`);
    console.log("Hydration E2E passed: bundle load -> mandu:hydrated -> React state update");
  } catch (error) {
    cleanupFixture = false;
    console.error(error instanceof Error ? error.message : String(error));
    if (testServer) {
      console.error(`Hydration E2E server port: ${testServer.server.server.port}`);
    }
    console.error(`Hydration E2E client output: ${path.join(fixtureRoot, ".mandu", "client")}`);
    console.error(`Hydration E2E fixture preserved at: ${fixtureRoot}`);
    process.exitCode = 1;
  } finally {
    testServer?.server.stop();
    await cleanupWithTimeout("dispose SSR importer", testServer?.importer.dispose(), 10_000);
    clearDefaultRegistry();
    if (cleanupFixture) {
      await cleanupWithTimeout("remove hydration E2E fixture", rm(fixtureRoot, { recursive: true, force: true }), 10_000);
    }
  }
}

const hardExitTimer = setTimeout(() => {
  console.error("Hydration E2E hard timeout after 120000ms");
  process.exit(1);
}, 120_000);

await main();
clearTimeout(hardExitTimer);
process.exit(process.exitCode ?? 0);
