import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { theme } from "../terminal";

function resolveLocalAtePath(cwd: string): string | undefined {
  // 1) explicit override
  const envPath = process.env.MANDU_ATE_PATH;
  if (envPath) return envPath;

  // 2) when running inside the mandu monorepo, CLI and ATE are siblings
  //    mandu/packages/cli/src/commands/add.ts -> mandu/packages/ate
  try {
    const here = new URL(".", import.meta.url);
    const monorepoGuess = resolve(decodeURIComponent(here.pathname), "../../../../ate");
    if (existsSync(join(monorepoGuess, "package.json"))) return monorepoGuess;
  } catch {
    // ignore
  }

  // 3) legacy guess (project lives next to a mandu checkout)
  const legacyGuess = join(cwd, "..", "mandu", "packages", "ate");
  if (existsSync(join(legacyGuess, "package.json"))) return legacyGuess;

  return undefined;
}

function run(cmd: string, args: string[], cwd: string): void {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
}

function runTry(cmd: string, args: string[], cwd: string): boolean {
  try {
    run(cmd, args, cwd);
    return true;
  } catch {
    return false;
  }
}

export async function addTest({ cwd = process.cwd() }: { cwd?: string } = {}): Promise<boolean> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    console.error(theme.error("package.json not found. Run inside a Mandu project."));
    return false;
  }

  console.log(theme.heading("🥟 Mandu ATE: installing test automation deps..."));

  // Install in project (no external SaaS deps)
  // NOTE: @mandujs/ate might be unpublished / private in some environments.
  // We try remote first, then fall back to a local `file:` install when available.
  const installed = runTry("bun", ["add", "-d", "@mandujs/ate", "@playwright/test", "playwright"], cwd);
  if (!installed) {
    const localAtePath = resolveLocalAtePath(cwd);
    if (localAtePath) {
      console.warn(theme.warn(`@mandujs/ate install failed. Falling back to local install: file:${localAtePath}`));
      run("bun", ["add", "-d", `file:${localAtePath}`, "@playwright/test", "playwright"], cwd);
    } else {
      console.error(theme.error("Failed to install @mandujs/ate."));
      console.error(theme.muted("Tried: bun add -d @mandujs/ate @playwright/test playwright"));
      console.error(theme.muted("If you're developing locally, set MANDU_ATE_PATH and retry:"));
      console.error(theme.muted("  MANDU_ATE_PATH=/abs/path/to/mandu/packages/ate bunx mandu add test"));
      return false;
    }
  }

  const browserInstalled = runTry("bunx", ["playwright", "install", "chromium"], cwd);
  if (!browserInstalled) {
    console.error(theme.error("Failed to install Playwright browsers. Try manually: bunx playwright install chromium"));
    return false;
  }

  // Create directories and baseline config
  const dirs = [
    join(cwd, "tests", "e2e", "auto"),
    join(cwd, "tests", "e2e", "manual"),
    join(cwd, ".mandu", "scenarios"),
    join(cwd, ".mandu", "reports"),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  console.log(theme.success("✅ ATE installed. Next: bunx mandu test:auto"));
  return true;
}
