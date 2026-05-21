#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import React, { Suspense } from "react";
import {
  clearDefaultRegistry,
  createServerRegistry,
  startServer,
  type ManduServer,
  type PageLoader,
} from "../packages/core/src/runtime/server";
import type { RoutesManifest } from "../packages/core/src/spec/schema";

const DEFAULT_RUNS = 3;
const DEFAULT_WARMUP = 1;
const DEFAULT_BUDGET_MS = 200;
const SLOW_MS = 250;
const REQUEST_TIMEOUT_MS = 10_000;

interface CliOptions {
  runs: number;
  warmup: number;
  budget: number;
  jsonOut: string;
}

interface StreamingSample {
  firstChunkMs: number;
  totalMs: number;
  bytes: number;
}

interface StreamingSummary {
  metric: "streaming_ssr_ttfb_p95_ms";
  runs: number;
  warmup: number;
  budget: number;
  p95: number;
  samples: StreamingSample[];
  status: "pass" | "fail";
}

function parseArgs(argv = process.argv.slice(2)): CliOptions {
  const options: CliOptions = {
    runs: DEFAULT_RUNS,
    warmup: DEFAULT_WARMUP,
    budget: DEFAULT_BUDGET_MS,
    jsonOut: path.join(process.cwd(), ".perf", "latest", "streaming-ssr.json"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--runs" && next) {
      options.runs = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--warmup" && next) {
      options.warmup = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--budget" && next) {
      options.budget = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--json-out" && next) {
      options.jsonOut = path.resolve(next);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  if (!Number.isInteger(options.warmup) || options.warmup < 0) {
    throw new Error("--warmup must be a non-negative integer");
  }
  if (!Number.isFinite(options.budget) || options.budget <= 0) {
    throw new Error("--budget must be a positive number");
  }

  return options;
}

async function AsyncSlowPage() {
  await new Promise<void>((resolve) => setTimeout(resolve, SLOW_MS));
  return React.createElement(
    "main",
    { id: "async-main" },
    React.createElement("h1", null, "slow-async-content"),
  );
}

function SyncShellPage() {
  return React.createElement(
    "div",
    { id: "shell" },
    React.createElement("h1", null, "shell-header"),
    React.createElement(
      Suspense,
      { fallback: React.createElement("p", { id: "fb" }, "loading-fallback") },
      React.createElement(AsyncSlowPage, null),
    ),
  );
}

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "bench/streaming-slow",
      pattern: "/streaming-slow",
      kind: "page",
      module: ".mandu/generated/server/bench-streaming-slow.ts",
      componentModule: "bench/streaming-slow/page.tsx",
      streaming: true,
    },
  ],
};

async function measure(url: string): Promise<StreamingSample> {
  const startedAt = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok || !res.body) {
    throw new Error(`Streaming bench request failed with HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const first = await readWithTimeout(reader, REQUEST_TIMEOUT_MS);
  const firstChunkMs = performance.now() - startedAt;
  if (first.done || !first.value) {
    throw new Error("Streaming response ended before the first chunk");
  }

  let bytes = first.value.byteLength;
  while (true) {
    const chunk = await readWithTimeout(reader, REQUEST_TIMEOUT_MS);
    if (chunk.done) break;
    bytes += chunk.value?.byteLength ?? 0;
  }

  return {
    firstChunkMs,
    totalMs: performance.now() - startedAt,
    bytes,
  };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Streaming response read timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]!;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const registry = createServerRegistry();
  let server: ManduServer | null = null;

  registry.registerPageLoader("bench/streaming-slow", (async () => ({
    default: SyncShellPage,
  })) as PageLoader);

  try {
    server = startServer(manifest, {
      port: 0,
      registry,
      streaming: true,
      silent: true,
    });
    const port = server.server.port;
    if (typeof port !== "number") {
      throw new Error("Streaming bench server did not bind to a numeric port");
    }
    const url = `http://127.0.0.1:${port}/streaming-slow`;

    for (let i = 0; i < options.warmup; i += 1) {
      await measure(url);
    }

    const samples: StreamingSample[] = [];
    for (let i = 0; i < options.runs; i += 1) {
      samples.push(await measure(url));
    }

    const p95 = percentile(samples.map((sample) => sample.firstChunkMs), 95);
    const summary: StreamingSummary = {
      metric: "streaming_ssr_ttfb_p95_ms",
      runs: options.runs,
      warmup: options.warmup,
      budget: options.budget,
      p95,
      samples,
      status: p95 <= options.budget ? "pass" : "fail",
    };

    await fs.mkdir(path.dirname(options.jsonOut), { recursive: true });
    await fs.writeFile(options.jsonOut, JSON.stringify(summary, null, 2), "utf8");

    console.log(
      `streaming_ssr_ttfb_p95_ms=${p95.toFixed(1)} budget=${options.budget.toFixed(1)} status=${summary.status}`,
    );

    if (summary.status === "fail") {
      process.exitCode = 1;
    }
  } finally {
    server?.stop();
    clearDefaultRegistry();
  }
}

if (import.meta.main) {
  await main();
  process.exit(process.exitCode ?? 0);
}
