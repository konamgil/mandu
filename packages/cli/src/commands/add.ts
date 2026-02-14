import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { theme } from "../terminal";

function sh(cmd: string, cwd: string) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function shTry(cmd: string, cwd: string): boolean {
  try {
    sh(cmd, cwd);
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
  const installed = shTry("bun add -d @mandujs/ate @playwright/test playwright", cwd);
  if (!installed) {
    const localAtePath = join(cwd, "..", "mandu", "packages", "ate");
    const localPkg = join(localAtePath, "package.json");
    if (existsSync(localPkg)) {
      console.log(theme.info(`@mandujs/ate not found on npm. Falling back to local install: file:${localAtePath}`));
      sh(`bun add -d file:${localAtePath} @playwright/test playwright`, cwd);
    } else {
      console.error(theme.error("@mandujs/ate not found on npm, and local fallback path not found."));
      console.error(theme.muted(`Expected: ${localPkg}`));
      console.error(theme.muted("Tip: install manually with: bun add -d file:/abs/path/to/mandu/packages/ate"));
      return false;
    }
  }

  sh("bunx playwright install chromium", cwd);

  // Create directories and baseline config
  sh("mkdir -p tests/e2e/auto tests/e2e/manual .mandu/scenarios .mandu/reports", cwd);

  console.log(theme.success("✅ ATE installed. Next: bunx mandu test:auto"));
  return true;
}
