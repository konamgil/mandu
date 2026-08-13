#!/usr/bin/env bun

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--");

function bundlerArgsFrom(args: string[]): string[] {
  const filtered: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--randomize") continue;
    if (arg === "--seed") {
      i++;
      continue;
    }
    if (arg.startsWith("--seed=")) continue;
    filtered.push(arg);
  }
  return filtered;
}

async function runTest(label: string, args: string[], env: Record<string, string> = {}): Promise<void> {
  console.log(`\n${label}`);
  console.log(`$ bun test ${args.join(" ")}`);

  const proc = Bun.spawn(["bun", "test", ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function runScript(label: string, args: string[], env: Record<string, string> = {}): Promise<void> {
  console.log(`\n${label}`);
  console.log(`$ bun run ${args.join(" ")}`);

  const proc = Bun.spawn(["bun", "run", ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

await runTest(
  "Core tests (bundler race-prone tests gated)",
  ["--timeout", "20000", "packages/core/src", "packages/core/tests", ...forwardedArgs],
  {
    MANDU_SKIP_BUNDLER_TESTS: "1",
    MANDU_SKIP_CORE_ISOLATED_TESTS: "1",
    DB_TEST_MYSQL_URL: "",
  }
);

await runScript(
  "Core MySQL resource e2e tests (isolated)",
  ["scripts/test-mysql-resource-e2e.ts"]
);

await runTest(
  "Core client bundle tests (isolated)",
  [
    "packages/core/src/bundler/build.test.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ],
);

await runTest(
  "Core file-backed SQLite session tests (isolated)",
  [
    "packages/core/src/filling/__tests__/session-sqlite.test.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ],
);

await runTest(
  "Core SQLite observability tests (isolated)",
  [
    "packages/core/tests/observability/sqlite-store.test.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ],
);

await runTest(
  "Core HMR server tests (isolated)",
  [
    "packages/core/src/bundler/__tests__/hmr-client.test.ts",
    "packages/core/src/bundler/__tests__/hdr.test.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ],
);

await runTest(
  "Core HMR regression tests (isolated)",
  [
    "packages/core/tests/hmr-matrix/regression.spec.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ],
  { MANDU_SKIP_BUNDLER_TESTS: "1" },
);

await runTest(
  "Core build semaphore tests (isolated)",
  [
    "packages/core/src/bundler/safe-build.test.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ],
);

await runTest(
  "Core JSX runtime shim tests (isolated)",
  [
    "packages/core/src/bundler/__tests__/jsx-runtime-shim.test.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ],
);

await runTest(
  "Core bundler tests (sequential)",
  [
    "packages/core/tests/bundler/dev-common-dir.test.ts",
    ...bundlerArgsFrom(forwardedArgs),
  ]
);
