/**
 * mandu lint — one-shot oxlint setup + runner for existing projects.
 *
 * `mandu init` scaffolds oxlint into new projects, but users whose
 * project predates the oxlint adoption need a path to adopt it
 * without hand-editing `package.json`, fetching the config, and
 * running install. This command closes that gap.
 *
 * ## Modes
 *
 *   - `mandu lint`              → runs the existing `lint` script
 *                                 (usually `oxlint .`). Errors out
 *                                 with a `--setup` hint if no such
 *                                 script exists.
 *   - `mandu lint --setup`      → installs oxlint as a devDep, copies
 *                                 `.oxlintrc.json` from the `default`
 *                                 template (if missing), wires the
 *                                 `lint` + `lint:fix` scripts, and
 *                                 runs `bun install` + an initial
 *                                 lint pass to show the baseline.
 *   - `mandu lint --setup --dry-run`
 *                              → prints every planned change without
 *                                 touching disk.
 *   - `mandu lint --setup --yes`
 *                              → skips any confirmation prompts
 *                                 (CI / scripts).
 *
 * ## Idempotence
 *
 * Every `--setup` step checks the current state first and prints
 * `(already present — skipping)` when a field/file already matches
 * the target shape. Running `mandu lint --setup` twice produces no
 * additional changes the second time.
 *
 * ## Safety
 *
 * - Never overwrites an existing `.oxlintrc.json`.
 * - Never overwrites an existing `lint` or `lint:fix` script (so a
 *   user who points `lint` at ESLint keeps their setup; the command
 *   prints an advisory and continues).
 * - `package.json` edits are a single atomic write at the end; a
 *   crash mid-run leaves the file untouched.
 */

import path from "node:path";
import { readTemplateFile } from "../util/templates.js";

const OXLINT_SCRIPT = "oxlint .";
const OXLINT_FIX_SCRIPT = "oxlint --fix .";
const OXLINT_VERSION_RANGE = "^1.61.0";
const OXLINTRC_RELPATH = ".oxlintrc.json";
const LINT_SCRIPT_KEY = "lint";
const LINT_FIX_SCRIPT_KEY = "lint:fix";

export interface LintOptions {
  /** Run setup instead of the existing lint script. */
  setup?: boolean;
  /** Print the plan but don't write anything. */
  dryRun?: boolean;
  /** Skip interactive prompts. Reserved — current setup is non-interactive. */
  yes?: boolean;
  /** Project root. Defaults to `process.cwd()`. */
  rootDir?: string;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

interface SetupReport {
  configCreated: boolean;
  configSkipped: boolean;
  scriptAdded: boolean;
  scriptConflict: boolean;
  scriptFixAdded: boolean;
  scriptFixConflict: boolean;
  devDepAdded: boolean;
  devDepSkipped: boolean;
  installRan: boolean;
  baselineErrors: number;
  baselineWarnings: number;
  baselineUnavailable: boolean;
}

export async function lint(options: LintOptions = {}): Promise<boolean> {
  const rootDir = options.rootDir ?? process.cwd();
  if (options.setup) {
    return runSetup(rootDir, {
      dryRun: options.dryRun === true,
      yes: options.yes === true,
    });
  }
  return runLint(rootDir);
}

/**
 * Execute the existing `lint` script via `bun run lint`. When the
 * script is missing we refuse to silently shell out to `oxlint .` —
 * that would hide the mis-setup and diverge from whatever the user's
 * `package.json` actually says to do.
 */
async function runLint(rootDir: string): Promise<boolean> {
  const pkg = await readPackageJson(rootDir);
  if (!pkg) {
    console.error("❌ package.json not found. Run `mandu lint` inside a Mandu project.");
    return false;
  }
  const script = pkg.scripts?.[LINT_SCRIPT_KEY];
  if (!script) {
    console.error(
      "❌ No `lint` script in package.json.\n" +
        "   Run `mandu lint --setup` to install and wire oxlint.",
    );
    return false;
  }
  console.log(`🥟 mandu lint — running \`bun run ${LINT_SCRIPT_KEY}\` (${script})`);
  const proc = Bun.spawn({
    cmd: ["bun", "run", LINT_SCRIPT_KEY],
    cwd: rootDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0;
}

async function runSetup(
  rootDir: string,
  opts: { dryRun: boolean; yes: boolean },
): Promise<boolean> {
  console.log("🥟 mandu lint — setup oxlint for existing project");
  if (opts.dryRun) {
    console.log("   (dry-run mode: no files will be modified)");
  }
  console.log("");

  const pkgPath = path.join(rootDir, "package.json");
  const pkg = await readPackageJson(rootDir);
  if (!pkg) {
    console.error("❌ package.json not found at " + pkgPath);
    return false;
  }

  const report: SetupReport = {
    configCreated: false,
    configSkipped: false,
    scriptAdded: false,
    scriptConflict: false,
    scriptFixAdded: false,
    scriptFixConflict: false,
    devDepAdded: false,
    devDepSkipped: false,
    installRan: false,
    baselineErrors: 0,
    baselineWarnings: 0,
    baselineUnavailable: false,
  };

  // 1) Copy .oxlintrc.json from the embedded `default` template if
  //    the user doesn't have one yet. We don't overwrite — a project
  //    that already hand-rolled an oxlint config keeps it verbatim.
  const configPath = path.join(rootDir, OXLINTRC_RELPATH);
  const configExists = await Bun.file(configPath).exists();
  if (configExists) {
    report.configSkipped = true;
    console.log(`  ✅ ${OXLINTRC_RELPATH} already present — kept as-is`);
  } else {
    const payload = await readTemplateFile("default", OXLINTRC_RELPATH);
    if (!payload) {
      console.error(
        `  ❌ Embedded template for ${OXLINTRC_RELPATH} not found — ` +
          "the CLI binary may be corrupted. Reinstall @mandujs/cli.",
      );
      return false;
    }
    if (opts.dryRun) {
      console.log(`  📝 would create ${OXLINTRC_RELPATH} (${payload.length} bytes)`);
    } else {
      await Bun.write(configPath, payload);
      console.log(`  📝 created ${OXLINTRC_RELPATH}`);
    }
    report.configCreated = true;
  }

  // 2) Wire scripts. We only add `lint` / `lint:fix` when absent; we
  //    never clobber a user-defined script — a project that already
  //    points `lint` at ESLint keeps theirs, and the user can flip
  //    the pointer later manually.
  const scripts: Record<string, string> = { ...(pkg.scripts ?? {}) };
  if (!scripts[LINT_SCRIPT_KEY]) {
    scripts[LINT_SCRIPT_KEY] = OXLINT_SCRIPT;
    report.scriptAdded = true;
    console.log(`  🔗 package.json scripts.${LINT_SCRIPT_KEY} ← "${OXLINT_SCRIPT}"`);
  } else if (scripts[LINT_SCRIPT_KEY] !== OXLINT_SCRIPT) {
    report.scriptConflict = true;
    console.log(
      `  ⚠️  scripts.${LINT_SCRIPT_KEY} already set to "${scripts[LINT_SCRIPT_KEY]}" — left alone`,
    );
    console.log(
      `     (to switch to oxlint, edit package.json manually: "lint": "${OXLINT_SCRIPT}")`,
    );
  } else {
    console.log(`  ✅ scripts.${LINT_SCRIPT_KEY} already set to "${OXLINT_SCRIPT}"`);
  }

  if (!scripts[LINT_FIX_SCRIPT_KEY]) {
    scripts[LINT_FIX_SCRIPT_KEY] = OXLINT_FIX_SCRIPT;
    report.scriptFixAdded = true;
    console.log(`  🔗 package.json scripts.${LINT_FIX_SCRIPT_KEY} ← "${OXLINT_FIX_SCRIPT}"`);
  } else if (scripts[LINT_FIX_SCRIPT_KEY] !== OXLINT_FIX_SCRIPT) {
    report.scriptFixConflict = true;
    console.log(
      `  ⚠️  scripts.${LINT_FIX_SCRIPT_KEY} already set to "${scripts[LINT_FIX_SCRIPT_KEY]}" — left alone`,
    );
  } else {
    console.log(`  ✅ scripts.${LINT_FIX_SCRIPT_KEY} already set`);
  }

  // 3) Add oxlint as a devDependency if missing. We don't downgrade a
  //    newer version the user already pinned.
  const devDeps: Record<string, string> = { ...(pkg.devDependencies ?? {}) };
  if (!devDeps.oxlint) {
    devDeps.oxlint = OXLINT_VERSION_RANGE;
    report.devDepAdded = true;
    console.log(`  📦 devDependencies.oxlint ← "${OXLINT_VERSION_RANGE}"`);
  } else {
    report.devDepSkipped = true;
    console.log(`  ✅ devDependencies.oxlint already pinned to "${devDeps.oxlint}"`);
  }

  const nextPkg: PackageJson = {
    ...pkg,
    scripts,
    devDependencies: devDeps,
  };
  const changed =
    report.scriptAdded ||
    report.scriptFixAdded ||
    report.devDepAdded;
  if (changed && !opts.dryRun) {
    await Bun.write(pkgPath, JSON.stringify(nextPkg, null, 2) + "\n");
  }

  // 4) Install so the oxlint binary is on disk for the baseline run.
  if (report.devDepAdded && !opts.dryRun) {
    console.log("");
    console.log("📥 Installing dependencies with `bun install`...");
    const install = Bun.spawn({
      cmd: ["bun", "install"],
      cwd: rootDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await install.exited;
    if (code !== 0) {
      console.error("❌ `bun install` failed (exit " + code + "). Setup partially complete.");
      return false;
    }
    report.installRan = true;
  }

  // 5) Baseline — one lint pass so the user sees the current error /
  //    warning count in a single glance. Never fails the command; a
  //    non-zero baseline is expected on most pre-oxlint codebases.
  if (!opts.dryRun) {
    console.log("");
    console.log("🔍 Running initial lint pass to show baseline...");
    const baseline = await runLintForBaseline(rootDir);
    if (baseline) {
      report.baselineErrors = baseline.errors;
      report.baselineWarnings = baseline.warnings;
    } else {
      report.baselineUnavailable = true;
    }
  }

  console.log("");
  printSetupSummary(report, opts.dryRun);
  return true;
}

async function readPackageJson(rootDir: string): Promise<PackageJson | null> {
  try {
    const file = Bun.file(path.join(rootDir, "package.json"));
    if (!(await file.exists())) return null;
    const text = await file.text();
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

interface LintBaseline {
  errors: number;
  warnings: number;
}

/**
 * Run oxlint once and parse the error / warning counts off stderr.
 * Returns `null` when the binary is missing or the output shape
 * doesn't match — we intentionally degrade rather than block.
 */
async function runLintForBaseline(rootDir: string): Promise<LintBaseline | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["bun", "x", "oxlint", "."],
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr] = await Promise.all([
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
    ]);
    await proc.exited;
    const match = stderr.match(/Found (\d+) warnings? and (\d+) errors?/);
    if (!match) return null;
    return {
      warnings: Number(match[1]),
      errors: Number(match[2]),
    };
  } catch {
    return null;
  }
}

function printSetupSummary(report: SetupReport, dryRun: boolean): void {
  const header = dryRun
    ? "═══ Setup plan (dry-run) ═══"
    : "═══ Setup complete ═══";
  console.log(header);

  const noChanges =
    report.configSkipped &&
    !report.configCreated &&
    !report.scriptAdded &&
    !report.scriptFixAdded &&
    !report.devDepAdded;

  if (noChanges) {
    console.log("  Nothing to do — oxlint already set up.");
    console.log("  Run `mandu lint` (or `bun run lint`) to execute.");
    return;
  }

  if (report.configCreated) {
    console.log(`  ✅ Created ${OXLINTRC_RELPATH}`);
  }
  if (report.devDepAdded) {
    console.log(`  ✅ Added devDependencies.oxlint ${OXLINT_VERSION_RANGE}`);
  }
  if (report.scriptAdded) {
    console.log(`  ✅ Added scripts.${LINT_SCRIPT_KEY}`);
  }
  if (report.scriptFixAdded) {
    console.log(`  ✅ Added scripts.${LINT_FIX_SCRIPT_KEY}`);
  }
  if (report.installRan) {
    console.log("  ✅ Installed packages");
  }
  if (report.baselineErrors > 0 || report.baselineWarnings > 0) {
    console.log(
      `  📊 Baseline: ${report.baselineErrors} error(s) / ${report.baselineWarnings} warning(s)`,
    );
  } else if (!report.baselineUnavailable && !dryRun) {
    console.log("  📊 Baseline: clean (0 errors / 0 warnings)");
  }
  if (report.scriptConflict || report.scriptFixConflict) {
    console.log("");
    console.log(
      "  ⚠️  Existing lint script(s) detected — not overwritten. See messages above.",
    );
  }
  console.log("");
  console.log("Next steps:");
  console.log("  • `mandu lint`       — run the linter");
  console.log("  • `bun run lint:fix` — safe autofix for selected rules");
  console.log("  • docs/tooling/eslint-to-oxlint.md — full migration guide");
}
