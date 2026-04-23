import path from "path";
import fs from "fs/promises";
import { createInterface } from "readline/promises";
import { CLI_ERROR_CODES, printCLIError } from "../errors";
import { renderMarkdown } from "../cli-ux/markdown.js";
import { startSpinner, runSteps } from "../terminal/progress";
import { theme } from "../terminal/theme";
// Phase 9b B — template bytes are embedded at compile-time via static
// `with { type: "file" }` imports. In dev, these resolve to on-disk paths;
// in a `bun build --compile` binary, to `$bunfs/root/...` virtual paths.
// Both forms are readable via `Bun.file(path)`.
import {
  loadTemplate as loadEmbeddedTemplate,
  resolveEmbeddedPath,
  getEmbeddedSkillIds,
  resolveSkillPayload,
} from "../util/templates";
// Phase 9.R2 — init-landing markdown payload is pre-embedded as a string
// via `with { type: "text" }` so `renderInitLanding()` can stay
// synchronous and work identically in compiled binaries. The old
// `readFileSync(… init-landing.md)` path was broken inside binaries
// because the file import resolved to a `$bunfs` virtual path.
import { CLI_UX_TEMPLATES } from "../../generated/cli-ux-manifest.js";
import {
  generateLockfile,
  writeLockfile,
  LOCKFILE_PATH,
} from "@mandujs/core";
// `setupClaudeSkills` is the dev-mode filesystem copier and remains the
// public API exposed by `@mandujs/skills`. The CLI no longer calls it
// directly (Phase 11.A: binary-safe path below), but we keep the type
// import (`SetupResult`) to preserve the existing summary contract and
// the value import for third-party consumers who import `init.ts` as a
// library and want to substitute their own skills strategy.
// `getSkillCount` is a pure constant — safe to call from any context.
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setupClaudeSkills as _setupClaudeSkillsFsCopy,
  getSkillCount,
  type SetupResult as SkillsSetupResult,
} from "@mandujs/skills/init-integration";

/**
 * Phase 11.A — Binary-safe Claude Code skills installer.
 *
 * Replaces the Phase 9 call path (`setupClaudeSkills(targetDir)` →
 * `copyFile(fs → fs)`) which silently 9x-ENOENT'd inside a compiled
 * binary because `@mandujs/skills` is never reachable from `$bunfs`.
 * The new implementation consumes the `SKILLS_MANIFEST` string payloads
 * embedded by `scripts/generate-template-manifest.ts`, so every skill
 * gets written using `fs.writeFile()` with known-good in-memory bytes.
 *
 * Output shape is identical to `setupClaudeSkills` so downstream
 * summary logic (`skillsResult.skillsInstalled` etc.) does not change.
 *
 * Layout: each skill is written to `.claude/skills/<id>/SKILL.md`
 * (Claude Code spec — one subdirectory per skill). Prior releases wrote
 * flat `<id>.md` files and Claude Code silently ignored them (#197).
 */
async function installEmbeddedClaudeSkills(
  targetDir: string
): Promise<SkillsSetupResult> {
  const result: SkillsSetupResult = {
    skillsInstalled: 0,
    settingsCreated: false,
    errors: [],
  };

  const skillsDir = path.join(targetDir, ".claude", "skills");
  try {
    await fs.mkdir(skillsDir, { recursive: true });
  } catch (err) {
    result.errors.push(
      `mkdir .claude/skills: ${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  for (const skillId of getEmbeddedSkillIds()) {
    const payload = resolveSkillPayload(skillId);
    if (payload === null) {
      // Manifest drift — an ID advertised by the generator but missing
      // from the emitted map. This is a hard bug, not a runtime edge.
      result.errors.push(
        `skill payload missing in manifest: ${skillId} ` +
          `(re-run scripts/generate-template-manifest.ts and rebuild)`
      );
      continue;
    }
    const skillSubdir = path.join(skillsDir, skillId);
    const destPath = path.join(skillSubdir, "SKILL.md");
    try {
      // mkdir recursive is idempotent — cheap to call once per skill even
      // when the parent `.claude/skills/` already exists.
      await fs.mkdir(skillSubdir, { recursive: true });
      await fs.writeFile(destPath, payload, "utf-8");
      result.skillsInstalled++;
    } catch (err) {
      result.errors.push(
        `write ${skillId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Shared Claude settings.json — manifest key must match
  // generator's SKILL_SETTINGS_REL (`.claude/settings.json`).
  const settingsPayload = resolveSkillPayload("settings/.claude/settings.json");
  if (settingsPayload === null) {
    result.errors.push(
      "settings payload missing in manifest: .claude/settings.json"
    );
    return result;
  }
  try {
    // Ensure the parent `.claude` directory exists — normally already
    // present thanks to the skills mkdir above, but `mkdir recursive`
    // is a no-op when the dir exists so this is safe.
    await fs.mkdir(path.join(targetDir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(targetDir, ".claude", "settings.json"),
      settingsPayload,
      "utf-8"
    );
    result.settingsCreated = true;
  } catch (err) {
    result.errors.push(
      `settings.json: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

export type CSSFramework = "tailwind" | "panda" | "none";
export type UILibrary = "shadcn" | "ark" | "none";

export interface InitOptions {
  name?: string;
  template?: string;
  css?: CSSFramework;
  ui?: UILibrary;
  theme?: boolean;
  minimal?: boolean;
  withCi?: boolean;
  yes?: boolean;
  noInstall?: boolean;
  exitOnSuccess?: boolean;
}

const ALLOWED_TEMPLATES = ["default", "realtime-chat", "auth-starter"] as const;
const DEFAULT_MAX_BACKUP_SUFFIX_ATTEMPTS = 50;
const BACKUP_SUFFIX_START_INDEX = 1;
type AllowedTemplate = (typeof ALLOWED_TEMPLATES)[number];

export function isAllowedTemplate(template: string): template is AllowedTemplate {
  return (ALLOWED_TEMPLATES as readonly string[]).includes(template);
}

function resolveTemplateName(template: string): AllowedTemplate | null {
  const normalized = path.posix.normalize(template.replace(/\\/g, "/")).trim();
  if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
    return null;
  }
  return isAllowedTemplate(normalized) ? normalized : null;
}

// Files to skip based on CSS/UI options
const CSS_FILES = [
  "tailwind.config.ts",
  "postcss.config.js",
  "app/globals.css",
];

const UI_FILES = [
  "src/client/shared/ui/button.tsx",
  "src/client/shared/ui/card.tsx",
  "src/client/shared/ui/input.tsx",
  "src/client/shared/ui/index.ts",
  "src/shared/utils/client/cn.ts",
];

interface CopyOptions {
  projectName: string;
  css: CSSFramework;
  ui: UILibrary;
  theme: boolean;
  coreVersion: string;
  cliVersion: string;
  mcpVersion: string;
}

function shouldSkipFile(relativePath: string, options: CopyOptions): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");

  // Skip CSS files if css is none
  if (options.css === "none") {
    if (CSS_FILES.some((f) => normalizedPath.endsWith(f))) {
      return true;
    }
  }

  // Skip UI files if ui is none
  if (options.ui === "none") {
    if (UI_FILES.some((f) => normalizedPath.endsWith(f))) {
      return true;
    }
    // Skip UI/shared directories
    if (normalizedPath.includes("src/client/shared/ui/")) return true;
    if (normalizedPath.includes("src/client/shared/lib/")) return true;
  }

  return false;
}

/**
 * Heuristic: decide whether a template file should be treated as UTF-8 text
 * (placeholder substitution allowed) or raw bytes (verbatim copy).
 *
 * All files currently shipped under `packages/cli/templates/*` are text, but
 * the byte path keeps the door open for binary assets (favicon.ico, fonts)
 * without risking UTF-8 replacement-character corruption.
 */
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".md", ".mdx",
  ".css", ".scss", ".html", ".xml",
  ".yaml", ".yml", ".toml", ".ini",
  ".txt", ".env", ".gitignore",
]);

/**
 * #244 — npm / bun publish silently drops `.gitignore` from tarballs.
 * We ship template ignore files as plain `gitignore` (no leading dot)
 * and rename on extraction so the scaffolded project still has a valid
 * `.gitignore`. Nothing else is remapped — this is a narrow workaround
 * for a single tooling quirk.
 */
function renameNpmStrippedDotfile(relPath: string): string {
  const parts = relPath.split("/");
  const last = parts[parts.length - 1];
  if (last === "gitignore") {
    parts[parts.length - 1] = ".gitignore";
    return parts.join("/");
  }
  return relPath;
}

function looksLikeText(relPath: string): boolean {
  const basename = relPath.split("/").pop() ?? "";
  // Dotfiles without an extension (e.g. `.gitignore`, `.env`) are text.
  if (basename.startsWith(".") && !basename.slice(1).includes(".")) return true;
  const dot = basename.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(basename.slice(dot).toLowerCase());
}

function applyPlaceholders(content: string, options: CopyOptions): string {
  return content
    .replace(/\{\{PROJECT_NAME\}\}/g, options.projectName)
    .replace(/\{\{CORE_VERSION\}\}/g, options.coreVersion)
    .replace(/\{\{CLI_VERSION\}\}/g, options.cliVersion)
    .replace(/\{\{MCP_VERSION\}\}/g, options.mcpVersion);
}

/**
 * Write all embedded template files for the given template into `dest`.
 *
 * Replaces the legacy `copyDir()` which walked the on-disk templates
 * directory. That approach broke under `bun build --compile` because
 * `import.meta.dir + ../../templates` does not exist inside the binary's
 * `$bunfs` virtual root. We now iterate the static manifest produced by
 * `scripts/generate-template-manifest.ts` and read each file through
 * `Bun.file(path)` — a form that Bun satisfies identically in dev and
 * compiled modes.
 *
 * Skip/transform semantics are preserved:
 *   - `shouldSkipFile` still respects `--css none` / `--ui none`.
 *   - Empty `ui/` and `lib/` directories are implicitly skipped because
 *     only file entries exist in the manifest; mkdir is on-demand.
 *   - Placeholder substitution (`{{PROJECT_NAME}}` etc.) runs for text
 *     files only; binary assets (future-proofing) pass bytes through.
 *   - Dark-mode CSS injection still triggers on `app/globals.css`.
 */
async function copyEmbeddedTemplate(
  templateName: string,
  dest: string,
  options: CopyOptions
): Promise<void> {
  const files = loadEmbeddedTemplate(templateName);
  if (!files) {
    throw new Error(
      `Embedded template not found: ${templateName}. ` +
        `This indicates a build-time generator error — re-run ` +
        `scripts/generate-template-manifest.ts.`
    );
  }

  await fs.mkdir(dest, { recursive: true });

  for (const entry of files) {
    if (shouldSkipFile(entry.relPath, options)) continue;

    // #244 — npm / bun publish unconditionally strip `.gitignore` from
    // tarballs (legacy convention). Ship template as `gitignore` and
    // rename to `.gitignore` on extraction so scaffolded projects get
    // a valid ignore file.
    const destRelPath = renameNpmStrippedDotfile(entry.relPath);
    const destPath = path.join(dest, destRelPath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    const bunFile = Bun.file(entry.embeddedPath);
    if (!(await bunFile.exists())) {
      throw new Error(
        `Embedded file missing at runtime: ${entry.relPath} ` +
          `(expected at ${entry.embeddedPath}). ` +
          `Re-run scripts/generate-template-manifest.ts and rebuild.`
      );
    }

    if (looksLikeText(entry.relPath)) {
      let content = await bunFile.text();
      content = applyPlaceholders(content, options);
      if (options.theme && entry.relPath === "app/globals.css") {
        content = addDarkModeCSS(content);
      }
      await fs.writeFile(destPath, content);
    } else {
      const bytes = new Uint8Array(await bunFile.arrayBuffer());
      await fs.writeFile(destPath, bytes);
    }
  }
}

// Internal test hook — exposes the legacy filesystem-walk signature so
// callers (e.g. future e2e tests against an unpacked npm tarball) can still
// exercise the bytes-to-disk path directly. Production code should use
// `copyEmbeddedTemplate()`.
export async function __copyEmbeddedTemplateForTests(
  templateName: string,
  dest: string,
  options: CopyOptions
): Promise<void> {
  return copyEmbeddedTemplate(templateName, dest, options);
}

function addDarkModeCSS(content: string): string {
  const darkModeCSS = `
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }`;

  // Insert dark mode after :root block
  return content.replace(
    /(:root\s*\{[^}]+\})/,
    `$1\n${darkModeCSS}`
  );
}

/**
 * Reads CLI/Core package versions at runtime and returns them as ^major.minor.0
 * Used to replace {{CORE_VERSION}}, {{CLI_VERSION}} in template package.json
 *
 * Phase 9b B — The CLI's own `package.json` is embedded at bundle time via a
 * static JSON import. In a `bun build --compile` binary, `import.meta.dir`
 * points at a virtual `$bunfs` path where the original on-disk relative
 * `../../package.json` cannot be read. Static JSON imports are inlined and
 * survive the compile step. Sibling `@mandujs/*` versions still attempt a
 * filesystem lookup (useful during dev / monorepo workflow); if that fails
 * — as it does inside a released binary where those modules aren't
 * node_modules-resolvable either — we fall back to the CLI version, which
 * is guaranteed to resolve because it's embedded.
 */
async function resolvePackageVersions(): Promise<{
  coreVersion: string;
  cliVersion: string;
  mcpVersion: string;
}> {
  const cliPkg = (await import("../../package.json", { with: { type: "json" } })).default as {
    version?: string;
    dependencies?: Record<string, string>;
  };
  const cliVersion = cliPkg.version ?? "0.0.0";

  const stripCaret = (range: string): string => range.replace(/^[\^~>=<\s]+/, "");

  const resolveSibling = async (
    pkgName: string,
    workspaceDir: string
  ): Promise<string> => {
    // 1) In dev / monorepo, try to resolve the real installed copy.
    try {
      const pkgPath = require.resolve(`${pkgName}/package.json`, {
        paths: [path.resolve(import.meta.dir, "../..")],
      });
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      if (pkg.version) return pkg.version;
    } catch {
      // fall through
    }
    // 2) Still in dev — walk up to the workspace sibling.
    try {
      const workspacePath = path.resolve(
        import.meta.dir,
        "../../../",
        workspaceDir,
        "package.json"
      );
      const pkg = JSON.parse(await fs.readFile(workspacePath, "utf-8"));
      if (pkg.version) return pkg.version;
    } catch {
      // fall through
    }
    // 3) Compiled binary fallback — read the peer version declared in the
    //    CLI's own embedded package.json. This keeps `mandu init` usable
    //    even when filesystem-based module resolution is impossible.
    const declared = cliPkg.dependencies?.[pkgName];
    if (declared) return stripCaret(declared);
    return cliVersion;
  };

  const coreVersion = await resolveSibling("@mandujs/core", "core");
  const mcpVersion = await resolveSibling("@mandujs/mcp", "mcp");

  return {
    coreVersion: `^${coreVersion}`,
    cliVersion: `^${cliVersion}`,
    mcpVersion: `^${mcpVersion}`,
  };
}

interface InteractiveAnswers {
  name: string;
  template: AllowedTemplate;
  install: boolean;
}

async function runInteractivePrompts(defaults: {
  name: string;
  template: string;
}): Promise<InteractiveAnswers> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n${theme.heading("🥟 Mandu Init")}\n`);

  // 1. Project name
  const nameInput = await rl.question(
    `  Project name ${theme.muted(`(${defaults.name})`)} : `
  );
  const name = nameInput.trim() || defaults.name;

  // 2. Template selection
  console.log(`\n  Select template:`);
  for (let i = 0; i < ALLOWED_TEMPLATES.length; i++) {
    const t = ALLOWED_TEMPLATES[i];
    const label = t === "default" ? "default (recommended)" : t;
    console.log(`    ${theme.accent(`${i + 1})`)} ${label}`);
  }
  const templateInput = await rl.question(
    `\n  Enter number ${theme.muted("(1)")} : `
  );
  const templateIndex = parseInt(templateInput.trim(), 10) - 1;
  const template: AllowedTemplate =
    templateIndex >= 0 && templateIndex < ALLOWED_TEMPLATES.length
      ? ALLOWED_TEMPLATES[templateIndex]
      : (resolveTemplateName(defaults.template) as AllowedTemplate) ?? "default";

  // 3. Install dependencies?
  const installInput = await rl.question(
    `\n  Install dependencies (bun install)? ${theme.muted("(Y/n)")} : `
  );
  const install = installInput.trim().toLowerCase() !== "n";

  rl.close();
  console.log();

  return { name, template, install };
}

export async function init(options: InitOptions = {}): Promise<boolean> {
  const isInteractive = process.stdin.isTTY && !options.yes;

  let projectName: string;
  let requestedTemplate: string;
  let shouldInstall: boolean;

  if (isInteractive) {
    const answers = await runInteractivePrompts({
      name: options.name || "my-mandu-app",
      template: options.template || "default",
    });
    projectName = answers.name;
    requestedTemplate = answers.template;
    shouldInstall = options.noInstall ? false : answers.install;
  } else {
    projectName = options.name || "my-mandu-app";
    requestedTemplate = options.template || "default";
    shouldInstall = !options.noInstall;
  }

  const template = resolveTemplateName(requestedTemplate);
  const targetDir = path.resolve(process.cwd(), projectName);

  if (!template) {
    printCLIError(CLI_ERROR_CODES.INIT_TEMPLATE_NOT_FOUND, { template: requestedTemplate });
    console.error(`   Available templates: ${ALLOWED_TEMPLATES.join(", ")}`);
    return false;
  }

  // Handle minimal flag (shortcut for --css none --ui none)
  const css: CSSFramework = options.minimal ? "none" : (options.css || "tailwind");
  const ui: UILibrary = options.minimal ? "none" : (options.ui || "shadcn");
  const themeEnabled = options.theme || false;
  const withCi = options.withCi || false;

  console.log(`${theme.heading("🥟 Mandu Init")}`);
  console.log(`${theme.info("📁")} Project: ${theme.accent(projectName)}`);
  console.log(`${theme.info("📦")} Template: ${theme.accent(template)}`);
  console.log(`${theme.info("🎨")} CSS: ${css}${css !== "none" ? " (Tailwind CSS)" : ""}`);
  console.log(`${theme.info("🧩")} UI: ${ui}${ui !== "none" ? " (shadcn/ui)" : ""}`);
  if (themeEnabled) {
    console.log(`${theme.info("🌙")} Theme: Dark mode enabled`);
  }
  if (withCi) {
    console.log(`${theme.info("🔄")} CI/CD: GitHub Actions workflows included`);
  }
  console.log();

  // Check if target directory exists
  try {
    await fs.access(targetDir);
    printCLIError(CLI_ERROR_CODES.INIT_DIR_EXISTS, { path: targetDir });
    return false;
  } catch {
    // Directory doesn't exist, good to proceed
  }

  // Template existence is verified against the embedded manifest — this
  // works identically in `bun run` dev mode and in a `--compile` binary,
  // because both resolve `Bun.file(path)` to something readable (either
  // on-disk or via `Bun.embeddedFiles`).
  const embeddedFiles = loadEmbeddedTemplate(template);
  if (!embeddedFiles || embeddedFiles.length === 0) {
    printCLIError(CLI_ERROR_CODES.INIT_TEMPLATE_NOT_FOUND, { template });
    console.error(`   Available templates: ${ALLOWED_TEMPLATES.join(", ")}`);
    return false;
  }

  const { coreVersion, cliVersion, mcpVersion } = await resolvePackageVersions();

  const copyOptions: CopyOptions = {
    projectName,
    css,
    ui,
    theme: themeEnabled,
    coreVersion,
    cliVersion,
    mcpVersion,
  };

  // Run structured steps with progress
  let mcpResult: McpConfigResult;
  let lockfileResult: LockfileResult;
  let skillsResult: SkillsSetupResult;

  try {
    await runSteps([
      {
        label: "Creating directory",
        fn: async () => {
          await fs.mkdir(targetDir, { recursive: true });
          await fs.mkdir(path.join(targetDir, ".mandu/client"), { recursive: true });
        },
      },
      {
        label: "Copying template",
        fn: () => copyEmbeddedTemplate(template, targetDir, copyOptions),
      },
      {
        label: "Generating config files",
        fn: async () => {
          if (withCi) {
            await setupCiWorkflows(targetDir);
          }
          if (css === "none") {
            await createMinimalLayout(targetDir, projectName);
          }
          if (ui === "none") {
            await createMinimalPage(targetDir);
          }
          if (css === "none" || ui === "none") {
            await updatePackageJson(targetDir, css, ui);
          }
        },
      },
      {
        label: "MCP configuration",
        fn: async () => {
          mcpResult = await setupMcpConfig(targetDir);
        },
      },
      {
        label: "Claude Code skills",
        fn: async () => {
          // Phase 11.A — was `setupClaudeSkills(targetDir)` which copied
          // from on-disk `@mandujs/skills/skills/<id>/SKILL.md`. That path
          // is unreachable inside a compiled binary and caused 9 silent
          // ENOENT warnings on `mandu.exe init` (Phase 9 audit I-03).
          // The embedded manifest gives us the same bytes synchronously
          // in both dev and binary modes.
          skillsResult = await installEmbeddedClaudeSkills(targetDir);
        },
      },
      {
        label: "Generating lockfile",
        fn: async () => {
          lockfileResult = await setupLockfile(targetDir);
        },
      },
    ]);
  } catch (error) {
    console.error(`\n${theme.error("❌")} Project creation failed:`, error);
    return false;
  }

  // Validate project files
  const requiredFiles = ["app/page.tsx", "package.json", "tsconfig.json"];
  const missingFiles: string[] = [];
  for (const file of requiredFiles) {
    try {
      await fs.access(path.join(targetDir, file));
    } catch {
      missingFiles.push(file);
    }
  }
  if (missingFiles.length > 0) {
    console.log(`\n${theme.warn("⚠")} Missing files: ${missingFiles.join(", ")}`);
  }

  // Auto install dependencies
  if (shouldInstall) {
    const stopSpinner = startSpinner("Installing packages (bun install)...");
    try {
      const proc = Bun.spawn(["bun", "install"], {
        cwd: targetDir,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        stopSpinner("Packages installed");
      } else {
        stopSpinner();
        console.log(`${theme.warn("⚠")} Package installation failed (exit code: ${exitCode})`);
        console.log(`   ${theme.muted("Run 'bun install' manually in the project directory.")}`);
      }
    } catch {
      stopSpinner();
      console.log(`${theme.warn("⚠")} Package installation skipped`);
      console.log(`   ${theme.muted("Run 'bun install' manually in the project directory.")}`);
    }
  }

  // Success message (markdown landing — Phase 9a)
  renderInitLanding({
    projectName,
    targetDir,
    shouldInstall,
    css,
    ui,
    mcpResult: mcpResult!,
    skillsResult: skillsResult!,
    lockfileResult: lockfileResult!,
  });

  if (options.exitOnSuccess) {
    process.exit(0);
  }

  return true;
}

async function createMinimalLayout(targetDir: string, _projectName: string): Promise<void> {
  const layoutContent = `/**
 * Root Layout (Minimal)
 *
 * - html/head/body tags are auto-generated by Mandu SSR
 * - Only define the common body wrapper here
 */

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}
`;
  await fs.writeFile(path.join(targetDir, "app/layout.tsx"), layoutContent);
}

async function createMinimalPage(targetDir: string): Promise<void> {
  const pageContent = `/**
 * Home Page (Minimal)
 *
 * Edit this file and see changes at http://localhost:3333
 */

export default function HomePage() {
  return (
    <main style={{
      display: "flex",
      minHeight: "100vh",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      padding: "2rem",
    }}>
      <div style={{
        textAlign: "center",
        color: "white",
      }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>🥟 Mandu</h1>
        <p style={{ fontSize: "1.2rem", opacity: 0.9 }}>
          Welcome to your new Mandu project!
        </p>
        <p style={{ fontSize: "1rem", opacity: 0.8, marginTop: "0.5rem" }}>
          Edit <code style={{
            background: "rgba(255,255,255,0.2)",
            padding: "0.2rem 0.5rem",
            borderRadius: "4px",
          }}>app/page.tsx</code> to get started.
        </p>
        <p style={{ marginTop: "1rem" }}>
          <a href="/api/health" style={{ color: "white" }}>API Health →</a>
        </p>
      </div>
    </main>
  );
}
`;
  await fs.writeFile(path.join(targetDir, "app/page.tsx"), pageContent);
}

async function updatePackageJson(
  targetDir: string,
  css: CSSFramework,
  ui: UILibrary
): Promise<void> {
  const pkgPath = path.join(targetDir, "package.json");
  const content = await fs.readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(content);

  if (css === "none") {
    // Remove Tailwind dependencies (v4)
    delete pkg.devDependencies?.tailwindcss;
    delete pkg.devDependencies?.["@tailwindcss/cli"];
    // Legacy v3 (just in case)
    delete pkg.devDependencies?.postcss;
    delete pkg.devDependencies?.autoprefixer;
  }

  if (ui === "none") {
    // Remove UI library dependencies
    delete pkg.dependencies?.["@radix-ui/react-slot"];
    delete pkg.dependencies?.["class-variance-authority"];
    delete pkg.dependencies?.clsx;
    delete pkg.dependencies?.["tailwind-merge"];
  }

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

type McpConfigStatus = "created" | "updated" | "unchanged" | "backed-up" | "error";

interface McpConfigFileResult {
  status: McpConfigStatus;
  backupPath?: string;
  error?: string;
}

interface McpConfigResult {
  mcpJson: McpConfigFileResult;
  claudeJson: McpConfigFileResult;
  geminiJson: McpConfigFileResult;
}

/**
 * Look up the init-landing markdown payload from the pre-embedded
 * CLI-UX manifest.
 *
 * The manifest is populated by `scripts/generate-template-manifest.ts`
 * (using `with { type: "text" }`), which inlines the raw markdown
 * **string** at compile time. Both `bun run` (dev) and
 * `bun build --compile` (binary) resolve it identically and
 * synchronously — no filesystem I/O is required. Returns `null` only
 * if the manifest was regenerated without the landing entry (should
 * never happen under normal build flow).
 */
function loadInitLandingTemplate(): string | null {
  return CLI_UX_TEMPLATES.get("init-landing") ?? null;
}

interface InitLandingContext {
  projectName: string;
  targetDir: string;
  shouldInstall: boolean;
  css: CSSFramework;
  ui: UILibrary;
  mcpResult: McpConfigResult;
  skillsResult: SkillsSetupResult;
  lockfileResult: { success: boolean; hash?: string };
}

function mcpStatusLine(
  label: string,
  result: McpConfigFileResult,
  createdNote?: string
): string[] {
  const lines: string[] = [];
  if (result.status === "created") {
    lines.push(`- \`${label}\` created${createdNote ? ` (${createdNote})` : ""}`);
  } else if (result.status === "updated") {
    lines.push(`- \`${label}\` mandu server added/updated`);
  } else if (result.status === "unchanged") {
    lines.push(`- \`${label}\` already up to date`);
  } else if (result.status === "backed-up") {
    lines.push(`- \`${label}\` parse failed → backed up and recreated`);
    if (result.backupPath) {
      lines.push(`  - Backup: \`${result.backupPath}\``);
    }
  } else if (result.status === "error") {
    lines.push(`- \`${label}\` setup failed: ${result.error ?? "unknown error"}`);
  }
  return lines;
}

/**
 * Render the `mandu init` completion landing screen.
 *
 * Loads the shared markdown template, substitutes project context
 * placeholders, and pipes the result through `renderMarkdown()` so it
 * adapts to the terminal (rich ANSI in TTY / plain text under NO_COLOR
 * / CI / pipes). Falls back to a minimal plain summary if the template
 * file cannot be read — never throws.
 */
function renderInitLanding(ctx: InitLandingContext): void {
  const cssLine = ctx.css !== "none"
    ? "\n- `app/globals.css` — Global CSS (Tailwind v4)"
    : "";
  const uiLines = ctx.ui !== "none"
    ? "\n- `src/client/shared/ui/` — UI components (shadcn)\n- `src/shared/utils/client/cn.ts` — Utilities (cn function)"
    : "";
  const installHint = ctx.shouldInstall ? "" : "\nbun install";

  const mcpLines = [
    ...mcpStatusLine(".mcp.json", ctx.mcpResult.mcpJson, "Claude Code auto-connect"),
    ...mcpStatusLine(".claude.json", ctx.mcpResult.claudeJson, "Claude MCP local scope"),
    ...mcpStatusLine(".gemini/settings.json", ctx.mcpResult.geminiJson, "Gemini CLI auto-connect"),
  ].join("\n");

  const skillsLines: string[] = [];
  if (ctx.skillsResult.skillsInstalled > 0) {
    skillsLines.push(`- ${ctx.skillsResult.skillsInstalled}/${getSkillCount()} skills installed to \`.claude/skills/\``);
  }
  if (ctx.skillsResult.settingsCreated) {
    skillsLines.push("- `.claude/settings.json` created (hooks + permissions)");
  }
  if (ctx.skillsResult.errors.length > 0) {
    for (const err of ctx.skillsResult.errors) {
      skillsLines.push(`- **Warning**: ${err}`);
    }
  }
  if (skillsLines.length === 0) {
    skillsLines.push("- No skills installed");
  }

  const lockfileLines = ctx.lockfileResult.success
    ? `- \`${LOCKFILE_PATH}\` created\n- Hash: \`${ctx.lockfileResult.hash ?? ""}\``
    : "- Lockfile generation skipped (no config)";

  // Phase 9.R2 — synchronous access; no try/catch needed around the
  // manifest lookup since it is a pure in-memory map populated at
  // module-init time. We still guard for a missing key (defensively) so
  // a partially-regenerated manifest cannot crash the happy path of
  // `mandu init`.
  const template = loadInitLandingTemplate();
  if (template === null) {
    // Last-resort fallback — keeps init usable if the manifest was
    // regenerated without the "init-landing" entry (should not happen
    // in normal builds — the generator hard-fails when the source file
    // is missing, so this only triggers for malformed hand-edits).
    console.log(`\n${theme.success("✅")} ${theme.heading("Project created!")}\n`);
    console.log(`Location: ${theme.path(ctx.targetDir)}`);
    console.log(`\nNext: cd ${ctx.projectName} && bun run dev`);
    return;
  }

  const filled = template
    .replace(/\{\{projectName\}\}/g, ctx.projectName)
    .replace(/\{\{targetDir\}\}/g, ctx.targetDir)
    .replace(/\{\{installHint\}\}/g, installHint)
    .replace(/\{\{cssLine\}\}/g, cssLine)
    .replace(/\{\{uiLines\}\}/g, uiLines)
    .replace(/\{\{mcpLines\}\}/g, mcpLines)
    .replace(/\{\{skillsLines\}\}/g, skillsLines.join("\n"))
    .replace(/\{\{lockfileLines\}\}/g, lockfileLines);

  console.log(`\n${renderMarkdown(filled)}`);
}

function logMcpConfigStatus(
  label: string,
  result: McpConfigFileResult,
  createdNote?: string
): void {
  if (result.status === "created") {
    console.log(`   ${label} created${createdNote ? ` (${createdNote})` : ""}`);
    return;
  }

  if (result.status === "updated") {
    console.log(`   ${label} mandu server added/updated`);
    return;
  }

  if (result.status === "unchanged") {
    console.log(`   ${label} already up to date`);
    return;
  }

  if (result.status === "backed-up") {
    console.log(`   ${label} parse failed → backed up and recreated`);
    if (result.backupPath) {
      console.log(`   Backup: ${result.backupPath}`);
    }
    return;
  }

  if (result.status === "error") {
    console.log(`   ${label} setup failed: ${result.error}`);
  }
}

/**
 * Configure .mcp.json / .claude.json / .gemini/settings.json (AI agent integration)
 * - Creates new file if not present
 * - Adds/updates only the mandu server entry if file exists (preserves other settings)
 */
interface SetupMcpConfigOptions {
  maxBackupSuffixAttempts?: number;
}

export const __test__ = {
  setupMcpConfig,
};

async function setupMcpConfig(
  targetDir: string,
  options: SetupMcpConfigOptions = {}
): Promise<McpConfigResult> {
  const mcpPath = path.join(targetDir, ".mcp.json");
  const claudePath = path.join(targetDir, ".claude.json");
  const geminiDir = path.join(targetDir, ".gemini");
  const geminiPath = path.join(geminiDir, "settings.json");

  // #174: Python mcp CLI 충돌 방지 — bin 이름 직접 지정
  const manduServer = {
    command: "bunx",
    args: ["mandu-mcp"],
    cwd: ".",
  };

  const updateMcpFile = async (filePath: string): Promise<McpConfigFileResult> => {
    const writeConfig = async (data: Record<string, unknown>) => {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
    };

    const fileExists = async (candidatePath: string) => {
      try {
        await fs.access(candidatePath);
        return true;
      } catch {
        return false;
      }
    };

    const getBackupPath = async (basePath: string) => {
      const base = `${basePath}.bak`;
      if (!(await fileExists(base))) {
        return base;
      }
      const maxBackupSuffixAttempts =
        options.maxBackupSuffixAttempts ?? DEFAULT_MAX_BACKUP_SUFFIX_ATTEMPTS;

      for (
        let suffixIndex = BACKUP_SUFFIX_START_INDEX;
        suffixIndex <= maxBackupSuffixAttempts;
        suffixIndex++
      ) {
        const candidate = `${basePath}.bak.${suffixIndex}`;
        if (!(await fileExists(candidate))) {
          return candidate;
        }
      }
      return `${basePath}.bak.${Date.now()}`;
    };

    try {
      const existingContent = await fs.readFile(filePath, "utf-8");
      let existing: Record<string, unknown>;

      try {
        existing = JSON.parse(existingContent) as Record<string, unknown>;
      } catch {
        const backupPath = await getBackupPath(filePath);
        await fs.writeFile(backupPath, existingContent);
        await writeConfig({ mcpServers: { mandu: manduServer } });
        return { status: "backed-up", backupPath };
      }

      if (!existing || typeof existing !== "object") {
        existing = {};
      }

      if (!existing.mcpServers || typeof existing.mcpServers !== "object") {
        existing.mcpServers = {};
      }

      const current = (existing.mcpServers as Record<string, unknown>).mandu;
      const isSame =
        current && JSON.stringify(current) === JSON.stringify(manduServer);

      if (isSame) {
        return { status: "unchanged" };
      }

      (existing.mcpServers as Record<string, unknown>).mandu = manduServer;
      await writeConfig(existing);
      return { status: "updated" };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
        await writeConfig({ mcpServers: { mandu: manduServer } });
        return { status: "created" };
      }
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const mcpJson = await updateMcpFile(mcpPath);
  const claudeJson = await updateMcpFile(claudePath);

  // Gemini CLI: .gemini/settings.json (project scope)
  await fs.mkdir(geminiDir, { recursive: true });
  const geminiJson = await updateMcpFile(geminiPath);

  return { mcpJson, claudeJson, geminiJson };
}

interface LockfileResult {
  success: boolean;
  hash?: string;
  error?: string;
}

/**
 * Generate initial lockfile (config integrity)
 */
async function setupLockfile(targetDir: string): Promise<LockfileResult> {
  try {
    // Initial config (defaults)
    const initialConfig = {
      name: path.basename(targetDir),
      version: "0.1.0",
      createdAt: new Date().toISOString(),
    };

    const lockfile = generateLockfile(initialConfig, {
      includeSnapshot: true,
      includeMcpServerHashes: false,
    });

    await writeLockfile(targetDir, lockfile);

    return {
      success: true,
      hash: lockfile.configHash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate CI/CD workflow files (.github/workflows)
 *
 * Sources the workflow YAMLs and `scripts/analyze-impact.ts` from the
 * embedded `default` template manifest. This keeps CI setup working
 * identically under `bun run` and under a compiled binary where the
 * on-disk `templates/default/.github/workflows` directory does not exist.
 */
async function setupCiWorkflows(targetDir: string): Promise<void> {
  const workflowsDir = path.join(targetDir, ".github/workflows");
  await fs.mkdir(workflowsDir, { recursive: true });

  try {
    const defaultFiles = loadEmbeddedTemplate("default");
    if (!defaultFiles) {
      console.warn("⚠️  CI/CD workflow setup skipped: default template manifest missing.");
      return;
    }

    // Copy every `.github/workflows/*.yml` from the default template.
    const workflowEntries = defaultFiles.filter((f) =>
      f.relPath.startsWith(".github/workflows/")
    );
    for (const entry of workflowEntries) {
      const destPath = path.join(targetDir, entry.relPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      const content = await Bun.file(entry.embeddedPath).text();
      await fs.writeFile(destPath, content);
    }

    // Copy the impact-analysis script (used by the workflow's `on: pull_request` job).
    const analyzeImpactPath = resolveEmbeddedPath(
      "default",
      "scripts/analyze-impact.ts"
    );
    if (analyzeImpactPath) {
      const scriptsDir = path.join(targetDir, "scripts");
      await fs.mkdir(scriptsDir, { recursive: true });
      const analyzeImpactDest = path.join(scriptsDir, "analyze-impact.ts");
      const content = await Bun.file(analyzeImpactPath).text();
      await fs.writeFile(analyzeImpactDest, content);
    }
  } catch (error) {
    console.warn(`⚠️  CI/CD workflow setup warning:`, error);
    // CI setup failure does not abort project creation
  }
}
