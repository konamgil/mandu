import fs from "fs/promises";
import path from "path";

const repoRoot = path.resolve(import.meta.dir, "..");
const demoRoot = path.join(repoRoot, "demo", "edge-workers-starter");
const workerPath = path.join(demoRoot, ".mandu", "workers", "worker.js");
const wranglerPath = path.join(demoRoot, "wrangler.toml");
const forbiddenWorkerStrings = [
  "axe-core",
  "jsdom",
  "happy-dom",
  "node:fs",
  "node:child_process",
  "Bun.sql",
];

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runBuild(): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "build:workers"], {
    cwd: demoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        "Edge workers build smoke failed.",
        `cwd: ${demoRoot}`,
        "command: bun run build:workers",
        `exitCode: ${exitCode}`,
        stdout ? `stdout:\n${stdout}` : "stdout:\n<empty>",
        stderr ? `stderr:\n${stderr}` : "stderr:\n<empty>",
      ].join("\n\n"),
    );
  }

  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

async function assertWorkerBundle(): Promise<void> {
  const [worker, wrangler] = await Promise.all([
    fs.readFile(workerPath, "utf8"),
    fs.readFile(wranglerPath, "utf8"),
  ]);

  if (!wrangler.includes(`main = ".mandu/workers/worker.js"`)) {
    throw new Error("wrangler.toml does not point to the generated Workers bundle.");
  }

  const leaks = forbiddenWorkerStrings.filter((value) => worker.includes(value));
  if (leaks.length > 0) {
    throw new Error(`Workers bundle contains target-unsafe imports/deps: ${leaks.join(", ")}`);
  }

  console.log(`Edge workers build smoke passed: ${path.relative(repoRoot, workerPath).replace(/\\/g, "/")}`);
}

await runBuild();
await assertWorkerBundle();
