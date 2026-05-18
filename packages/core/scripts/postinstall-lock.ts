/**
 * Refresh an existing Guard lock after package-manager updates.
 *
 * Lifecycle scripts run from inside the installed package, so projectRoot
 * defaults to INIT_CWD when Bun provides it. This helper is intentionally
 * best-effort: installs must not fail because a project has a stale, invalid,
 * or temporarily unreadable Mandu config.
 */

import path from "node:path";
import {
  validateConfig,
  type ValidatedManduConfig,
} from "../src/config/validate.js";
import { CONFIG_FILES } from "../src/config/mandu.js";
import {
  generateLockfile,
  readLockfile,
  readMcpConfig,
  writeLockfile,
  LOCKFILE_PATH,
} from "../src/lockfile/index.js";

export type PostinstallLockAction =
  | "updated"
  | "skipped-disabled"
  | "skipped-no-project-config"
  | "skipped-no-lockfile"
  | "skipped-invalid-lockfile"
  | "skipped-invalid-config"
  | "skipped-invalid-mcp-config"
  | "skipped-write-failed";

export interface PostinstallLockResult {
  action: PostinstallLockAction;
  projectRoot: string;
  hash?: string;
  error?: string;
}

export interface PostinstallLockOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  verbose?: boolean;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export async function refreshGuardLockAfterInstall(
  options: PostinstallLockOptions = {},
): Promise<PostinstallLockResult> {
  const env = options.env ?? process.env;
  const projectRoot = path.resolve(
    options.projectRoot ?? env.INIT_CWD ?? process.cwd(),
  );
  const verbose = options.verbose ?? env.MANDU_POSTINSTALL_VERBOSE === "1";
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;

  const report = (result: PostinstallLockResult): PostinstallLockResult => {
    if (verbose) {
      if (result.action === "updated") {
        log(`[Mandu] refreshed ${LOCKFILE_PATH} (${result.hash})`);
      } else if (result.error) {
        warn(`[Mandu] ${result.action}: ${result.error}`);
      } else {
        log(`[Mandu] ${result.action}`);
      }
    }
    return result;
  };

  if (env.MANDU_POSTINSTALL_LOCK === "0") {
    return report({ action: "skipped-disabled", projectRoot });
  }

  if (!(await hasProjectConfig(projectRoot))) {
    return report({ action: "skipped-no-project-config", projectRoot });
  }

  let existingLockfile: Awaited<ReturnType<typeof readLockfile>>;
  try {
    existingLockfile = await readLockfile(projectRoot);
  } catch (error) {
    return report({
      action: "skipped-invalid-lockfile",
      projectRoot,
      error: stringifyError(error),
    });
  }

  if (!existingLockfile) {
    return report({ action: "skipped-no-lockfile", projectRoot });
  }

  const validation = await validateConfig(projectRoot);
  if (!validation.valid || !validation.config) {
    return report({
      action: "skipped-invalid-config",
      projectRoot,
      error:
        validation.errors?.map((entry) => entry.message).join("; ") ??
        "Mandu config validation failed",
    });
  }

  let mcpConfig: Record<string, unknown> | null;
  try {
    mcpConfig = await readMcpConfig(projectRoot);
  } catch (error) {
    return report({
      action: "skipped-invalid-mcp-config",
      projectRoot,
      error: stringifyError(error),
    });
  }

  try {
    const lockfile = generateLockfile(
      validation.config as ValidatedManduConfig,
      {
        includeSnapshot: existingLockfile.snapshot !== undefined,
        includeMcpServerHashes: true,
      },
      mcpConfig,
    );
    await writeLockfile(projectRoot, lockfile);
    return report({ action: "updated", projectRoot, hash: lockfile.configHash });
  } catch (error) {
    return report({
      action: "skipped-write-failed",
      projectRoot,
      error: stringifyError(error),
    });
  }
}

async function hasProjectConfig(projectRoot: string): Promise<boolean> {
  for (const fileName of CONFIG_FILES) {
    if (await Bun.file(path.join(projectRoot, fileName)).exists()) {
      return true;
    }
  }
  return false;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
  await refreshGuardLockAfterInstall();
}
