import fs from "fs/promises";
import path from "path";

const STABLE_SUBPATHS = new Set([
  "client",
  "config",
  "contract",
  "error",
  "guard",
  "middleware",
  "plugins",
  "router",
  "runtime",
  "testing",
]);

const INDEX_SUBPATHS = new Set([
  "a11y",
  "agent",
  "auth",
  "brain",
  "bundler",
  "bundler/plugins",
  "change",
  "content",
  "db",
  "db/migrations",
  "deploy",
  "design",
  "desktop",
  "dev-error-overlay",
  "diagnose",
  "email",
  "experimental",
  "filling",
  "generator",
  "i18n",
  "id",
  "internal",
  "kitchen",
  "lockfile",
  "logging",
  "middleware/oauth",
  "middleware/rate-limit",
  "middleware/secure",
  "observability",
  "perf",
  "resource",
  "routes",
  "scheduler",
  "storage/s3",
  "testing",
  "watcher",
]);

const COMPAT_ALIASES: Readonly<Record<string, string>> = {
  "components/Image": "components/Image-compat",
};

function compatibilityTarget(subpath: string): string {
  const withoutSourceExtension = subpath.replace(/\.(?:[cm]?[jt]sx?)$/, "");
  const aliased = COMPAT_ALIASES[withoutSourceExtension] ?? withoutSourceExtension;
  if (INDEX_SUBPATHS.has(aliased)) return `${aliased}/index`;
  return aliased;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".mandu",
  "dist",
  "node_modules",
]);

const IGNORED_FILES = new Set(["core-v1-imports.test.ts"]);

export interface CoreV1ImportChange {
  file: string;
  replacements: number;
}

export interface CoreV1ImportMigrationResult {
  scannedFiles: number;
  changes: CoreV1ImportChange[];
  written: boolean;
}

export function rewriteCoreV1Imports(source: string): {
  source: string;
  replacements: number;
} {
  let replacements = 0;
  const migrated = source.replace(
    /(?<!\\)(["'])@mandujs\/core\/([^"']+)\1/g,
    (match, quote: string, subpath: string) => {
      if (STABLE_SUBPATHS.has(subpath)) {
        return match;
      }
      const currentCompat = subpath.startsWith("compat/");
      const legacySubpath = currentCompat ? subpath.slice("compat/".length) : subpath;
      const suffix = compatibilityTarget(legacySubpath);
      if (currentCompat && suffix === legacySubpath) return match;
      replacements += 1;
      return `${quote}@mandujs/core/compat/${suffix}${quote}`;
    },
  );
  return { source: migrated, replacements };
}

async function collectSourceFiles(target: string, out: string[]): Promise<void> {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return;
  if (stat.isFile()) {
    if (
      SOURCE_EXTENSIONS.has(path.extname(target)) &&
      !IGNORED_FILES.has(path.basename(target))
    ) {
      out.push(target);
    }
    return;
  }
  if (!stat.isDirectory()) return;

  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    await collectSourceFiles(path.join(target, entry.name), out);
  }
}

export async function migrateCoreV1Imports(
  targets: readonly string[],
  options: { cwd?: string; write?: boolean } = {},
): Promise<CoreV1ImportMigrationResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const files: string[] = [];
  for (const target of targets.length > 0 ? targets : ["."]) {
    const resolved = path.resolve(cwd, target);
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
      throw new Error(`Codemod target escapes the project root: ${target}`);
    }
    await collectSourceFiles(resolved, files);
  }

  const changes: CoreV1ImportChange[] = [];
  for (const file of [...new Set(files)].sort()) {
    const before = await fs.readFile(file, "utf8");
    const result = rewriteCoreV1Imports(before);
    if (result.replacements === 0) continue;
    if (options.write) await fs.writeFile(file, result.source, "utf8");
    changes.push({
      file: path.relative(cwd, file).split(path.sep).join("/"),
      replacements: result.replacements,
    });
  }

  return {
    scannedFiles: files.length,
    changes,
    written: options.write === true,
  };
}
