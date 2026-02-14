import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { theme } from "../terminal";

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
  // NOTE: @mandujs/ate might not be published yet. In that case, fallback to local file: install.
  const installed = runTry("bun", ["add", "-d", "@mandujs/ate", "@playwright/test", "playwright"], cwd);
  if (!installed) {
    const localAtePath = join(cwd, "..", "mandu", "packages", "ate");
    const localPkg = join(localAtePath, "package.json");
    if (existsSync(localPkg)) {
      console.warn(theme.warn(`@mandujs/ate not found on npm. Falling back to local install: file:${localAtePath}`));
      run("bun", ["add", "-d", `file:${localAtePath}`, "@playwright/test", "playwright"], cwd);
    } else {
      console.error(theme.error("@mandujs/ate not found on npm, and local fallback path not found."));
      console.error(theme.muted(`Expected: ${localPkg}`));
      console.error(theme.muted("Tip: install manually with: bun add -d file:/abs/path/to/mandu/packages/ate"));
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
