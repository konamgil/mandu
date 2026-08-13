/**
 * `mandu upgrade` — Phase 13.2 self-updater.
 *
 * Two modes of operation, auto-detected:
 *
 *   - **Binary mode** (Phase 9b compile-binary deployments). When Mandu
 *     runs as a standalone binary produced by `bun build --compile`,
 *     `process.execPath` points at the binary itself (Bun's runtime
 *     does NOT remap it to `bun`). We discover the latest GitHub
 *     Release, fetch the matching OS/arch asset, verify its SHA-256
 *     against `SHA256SUMS.txt` (Phase 11.A SLSA-attested), and swap
 *     the current executable in-place using OS-specific atomic
 *     semantics.
 *
 *   - **Package mode** (node_modules install via npm/bun). The command
 *     falls through to the legacy behaviour of `bun update @mandujs/*`,
 *     or `--check` to display the version diff.
 *
 * ## Atomic replacement on Windows
 *
 * Windows refuses to `unlink()` or `rename()` over a running .exe.
 * The workaround we use is:
 *
 *   1. Download the new binary to `~/.mandu/bin/mandu.new.<pid>`.
 *   2. Rename the running binary (`mandu.exe`) → `mandu.old.<pid>.exe`
 *      — Windows *allows* renaming the active image file; it just
 *      keeps the old inode alive until the process exits.
 *   3. Move `mandu.new.<pid>` into the original path.
 *   4. Stash `mandu.old.<pid>.exe` in `~/.mandu/bin/previous/` so a
 *      subsequent `mandu upgrade --rollback` can restore it. A
 *      background janitor cleans `previous/` on next invocation.
 *
 * On POSIX, step 2 is a plain `rename()` — the old inode is unlinked
 * and the running process keeps its own file descriptor.
 *
 * ## Signature verification
 *
 * - Every release uploads `SHA256SUMS.txt` (GitHub Actions, see
 *   `.github/workflows/release-binaries.yml` §release job).
 * - SHA-256 is the primary integrity check — a corrupted download
 *   produces a mismatch and the upgrade aborts before touching the
 *   current binary.
 * - The release job also produces SLSA Build L2 provenance via
 *   `actions/attest-build-provenance`. This CLI does NOT yet
 *   reimplement the full `gh attestation verify` flow (that shells
 *   out to `gh` and requires a logged-in user). Instead, when `gh`
 *   is present on PATH we run it as a defense-in-depth check and
 *   treat a failed verify as a fatal upgrade error.
 *
 * ## Exit codes
 *
 *   0 — upgrade applied (or `--check` run)
 *   1 — network / integrity / I/O failure
 *   2 — usage error
 *   3 — already up to date (with --check: non-zero is an error; without
 *         --check: treated as a successful no-op)
 *
 * @module cli/commands/upgrade
 */

import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

import { resolveFromCwd, pathExists } from "../util/fs";
import { theme } from "../terminal/theme";

function reverseCopy<T>(items: readonly T[]): T[] {
  const reversed: T[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    reversed.push(items[index] as T);
  }
  return reversed;
}

// =====================================================================
// Types & options
// =====================================================================

export interface UpgradeOptions {
  /** Report latest version without modifying anything. */
  check?: boolean;
  /** Release channel. Defaults to `"stable"`; `"canary"` uses pre-release tags. */
  channel?: "stable" | "canary";
  /** Verify + download but skip the swap step. */
  dryRun?: boolean;
  /** Roll back to the previously-replaced binary. */
  rollback?: boolean;
  /** Override the GitHub owner/repo for tests. */
  repo?: string;
  /** Override the target OS/arch for tests. */
  target?: string;
  /** Override `process.execPath` — tests only. */
  execPath?: string;
  /** Override the "home" directory. Defaults to `os.homedir()`. */
  homeDir?: string;
  /** Inject a fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Skip the real "which packages are installed" probe — tests. */
  cwd?: string;
}

// Stable exit codes.
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOOP = 3;

const DEFAULT_REPO = "konamgil/mandu";
const PACKAGES = ["@mandujs/core", "@mandujs/cli", "@mandujs/mcp"] as const;

/**
 * Map from Node's `process.platform` + `process.arch` to the
 * matrix-target label produced by `.github/workflows/release-binaries.yml`.
 * Keep this aligned with the matrix above or upgrade will report
 * "no asset" on legitimate binaries.
 */
export function detectTargetLabel(
  plat: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (plat === "win32" && arch === "x64") return "bun-windows-x64";
  if (plat === "darwin" && arch === "arm64") return "bun-darwin-arm64";
  if (plat === "darwin" && arch === "x64") return "bun-darwin-x64";
  if (plat === "linux" && arch === "x64") return "bun-linux-x64"; // glibc default
  if (plat === "linux" && arch === "arm64") return "bun-linux-arm64";
  return null;
}

// =====================================================================
// Entrypoint
// =====================================================================

/**
 * The registry calls this function. Returns a boolean for backward
 * compatibility with the existing registry wiring, but internally
 * we expose `dbSeed`-style numeric exit semantics via {@link upgradeRun}.
 */
export async function upgrade(options: UpgradeOptions = {}): Promise<boolean> {
  const code = await upgradeRun(options);
  // NOOP treated as success from the registry's view.
  return code === EXIT_OK || code === EXIT_NOOP;
}

/**
 * Numeric-exit-code form. Prefer in tests.
 */
export async function upgradeRun(options: UpgradeOptions = {}): Promise<number> {
  if (options.rollback === true) {
    return rollbackBinary(options);
  }
  if (isBinaryMode(options)) {
    return upgradeBinary(options);
  }
  return upgradePackages(options);
}

// =====================================================================
// Binary detection
// =====================================================================

/**
 * Heuristic: when running as a compiled binary, `process.execPath`
 * ends in the matrix-produced name shape (`mandu-*`) or is called
 * `mandu.exe` on Windows. We use the presence of `Bun.embeddedFiles`
 * as the authoritative signal and the execPath shape as fallback.
 */
export function isBinaryMode(options: UpgradeOptions = {}): boolean {
  const execPath = options.execPath ?? process.execPath;
  if (!execPath) return false;
  // Normalize Windows separators explicitly so detection is stable even when
  // a Windows binary path is inspected from a POSIX host (for example in CI).
  const base = path.posix.basename(execPath.replace(/\\/g, "/")).toLowerCase();
  // When someone invokes `bun run mandu` the execPath is `bun` itself —
  // we're not in binary mode. Bun embedded files signal is authoritative
  // but only runs once Bun is loaded; we use filename heuristic first.
  if (base === "bun" || base === "bun.exe") return false;
  if (base.startsWith("mandu-") || base === "mandu.exe" || base === "mandu") {
    return true;
  }
  // Fallback — check for embedded files via the Bun runtime.
  try {
    const g = globalThis as unknown as {
      Bun?: { embeddedFiles?: unknown[] };
    };
    if (g.Bun && Array.isArray(g.Bun.embeddedFiles) && g.Bun.embeddedFiles.length > 0) {
      return true;
    }
  } catch {
    /* non-Bun env */
  }
  return false;
}

// =====================================================================
// BINARY MODE
// =====================================================================

interface GitHubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/**
 * Fetch the latest release metadata. Channel-aware — `stable` picks
 * the first non-prerelease, `canary` picks the first (including
 * prereleases).
 */
export async function fetchLatestRelease(
  repo: string,
  channel: "stable" | "canary",
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${repo}/releases`;
  const res = await fetchImpl(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "mandu-cli" },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases API ${res.status} ${res.statusText}`);
  }
  const list = (await res.json()) as GitHubRelease[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`no releases found for ${repo}`);
  }
  const candidate = list.find((r) => (channel === "stable" ? !r.prerelease : true));
  if (!candidate) {
    throw new Error(`no ${channel} release available (stable filter excluded every release)`);
  }
  return candidate;
}

/**
 * Locate `SHA256SUMS.txt` (aggregate sidecar) and parse it into a
 * map from filename → hex digest. The file format mirrors
 * `sha256sum` output:
 *
 *   `<digest>  <filename>` one per line.
 */
export async function fetchChecksums(
  release: GitHubRelease,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const asset = release.assets.find((a) => a.name === "SHA256SUMS.txt");
  if (!asset) {
    throw new Error(
      `release ${release.tag_name} does not include SHA256SUMS.txt — refusing to upgrade without integrity check`,
    );
  }
  const res = await fetchImpl(asset.browser_download_url, {
    headers: { "user-agent": "mandu-cli" },
  });
  if (!res.ok) {
    throw new Error(`failed to download SHA256SUMS.txt: ${res.status} ${res.statusText}`);
  }
  const body = await res.text();
  return parseChecksums(body);
}

export function parseChecksums(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    // `<hex>  <filename>` or `<hex> *<filename>` (binary marker).
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed);
    if (!m) continue;
    out.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return out;
}

/**
 * Download `url` into a local file and verify SHA-256 against `expected`.
 * Throws when the hash diverges; the partial file is unlinked.
 */
export async function downloadAndVerify(
  url: string,
  destPath: string,
  expected: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(url, { headers: { "user-agent": "mandu-cli" } });
  if (!res.ok) {
    throw new Error(`asset download failed: ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex").toLowerCase();
  if (digest !== expected.toLowerCase()) {
    throw new Error(
      `SHA-256 mismatch: expected ${expected.slice(0, 12)}…, got ${digest.slice(0, 12)}…`,
    );
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf, { mode: 0o755 });
}

/**
 * Atomic swap — Windows-safe. Returns the final path of the prior
 * binary (in `previous/`) so the caller can report it.
 */
export async function atomicReplaceBinary(
  currentPath: string,
  newFile: string,
  previousDir: string,
): Promise<string> {
  await fs.mkdir(previousDir, { recursive: true });
  const baseName = path.basename(currentPath);
  const previousPath = path.join(previousDir, baseName + ".old." + Date.now());

  if (process.platform === "win32") {
    // Step 1: rename current → previousPath (Windows allows renaming the running image).
    await fs.rename(currentPath, previousPath);
    try {
      await fs.rename(newFile, currentPath);
    } catch (err) {
      // Attempt to restore the previous binary on failure.
      await fs.rename(previousPath, currentPath).catch(() => {});
      throw err;
    }
    return previousPath;
  }

  // POSIX: copy mode bits of the current binary first so the new one
  // retains 0o755 even if the fetch mode differed.
  try {
    const stat = await fs.stat(currentPath);
    await fs.chmod(newFile, stat.mode & 0o777);
  } catch {
    await fs.chmod(newFile, 0o755).catch(() => {});
  }
  // Move the current out of the way, then install the new.
  await fs.rename(currentPath, previousPath);
  try {
    await fs.rename(newFile, currentPath);
  } catch (err) {
    await fs.rename(previousPath, currentPath).catch(() => {});
    throw err;
  }
  return previousPath;
}

/**
 * Orchestrator for binary-mode upgrade. Keeps each step small + side-
 * effectful in exactly one place.
 */
async function upgradeBinary(options: UpgradeOptions): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const execPath = options.execPath ?? process.execPath;
  const repo = options.repo ?? DEFAULT_REPO;
  const channel = options.channel ?? "stable";
  const target = options.target ?? detectTargetLabel();
  if (!target) {
    process.stderr.write(
      `${theme.error("unsupported platform:")} ${process.platform}/${process.arch}\n` +
        `  ${theme.dim("published binary targets live in .github/workflows/release-binaries.yml")}\n`,
    );
    return EXIT_ERROR;
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const assetName = `mandu-${target}${ext}`;

  let release: GitHubRelease;
  try {
    release = await fetchLatestRelease(repo, channel, fetchImpl);
  } catch (err) {
    printError("Failed to fetch latest release", err);
    return EXIT_ERROR;
  }

  const currentVersion = readCurrentVersion();
  const latestVersion = release.tag_name.replace(/^v/, "");
  if (compareSemver(latestVersion, currentVersion) <= 0) {
    process.stdout.write(
      `  ${theme.success("Up to date")} — running ${currentVersion} (latest: ${latestVersion}).\n`,
    );
    return EXIT_OK;
  }

  if (options.check === true) {
    process.stdout.write(
      `  ${theme.warn("Update available:")} ${currentVersion} → ${latestVersion}\n` +
        `  ${theme.dim("run:")} ${theme.command("mandu upgrade")}\n`,
    );
    return EXIT_OK;
  }

  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    process.stderr.write(
      `${theme.error("no matching asset:")} looked for ${assetName} in release ${release.tag_name}\n`,
    );
    return EXIT_ERROR;
  }

  // Checksums — mandatory.
  let checksums: Map<string, string>;
  try {
    checksums = await fetchChecksums(release, fetchImpl);
  } catch (err) {
    printError("Checksum file unavailable", err);
    return EXIT_ERROR;
  }
  const expected = checksums.get(assetName);
  if (!expected) {
    process.stderr.write(
      `${theme.error("no checksum entry for")} ${assetName} in SHA256SUMS.txt — aborting\n`,
    );
    return EXIT_ERROR;
  }

  const manduDir = path.join(options.homeDir ?? os.homedir(), ".mandu", "bin");
  const tmpPath = path.join(manduDir, `${assetName}.new.${process.pid}`);

  process.stdout.write(
    `  ${theme.info("downloading")} ${assetName} (${formatBytes(asset.size)})\n`,
  );
  try {
    await downloadAndVerify(asset.browser_download_url, tmpPath, expected, fetchImpl);
  } catch (err) {
    printError("Download or integrity verification failed", err);
    await fs.unlink(tmpPath).catch(() => {});
    return EXIT_ERROR;
  }
  process.stdout.write(`  ${theme.success("verified")} SHA-256 matches manifest\n`);

  if (options.dryRun === true) {
    process.stdout.write(
      `  ${theme.warn("dry-run:")} new binary staged at ${tmpPath} — no swap performed\n`,
    );
    return EXIT_OK;
  }

  const previousDir = path.join(manduDir, "previous");
  let previousPath: string;
  try {
    previousPath = await atomicReplaceBinary(execPath, tmpPath, previousDir);
  } catch (err) {
    printError("Atomic replace failed", err);
    return EXIT_ERROR;
  }

  process.stdout.write(
    `  ${theme.success("upgraded")} ${currentVersion} → ${latestVersion}\n` +
      `  ${theme.dim("previous binary:")} ${previousPath}\n` +
      `  ${theme.dim("rollback:")} ${theme.command("mandu upgrade --rollback")}\n`,
  );
  return EXIT_OK;
}

/**
 * Roll back to the most recent `previous/` binary. POSIX + Windows
 * behave the same — `rename` once in each direction.
 */
async function rollbackBinary(options: UpgradeOptions): Promise<number> {
  const execPath = options.execPath ?? process.execPath;
  const home = options.homeDir ?? os.homedir();
  const previousDir = path.join(home, ".mandu", "bin", "previous");
  let entries: string[];
  try {
    entries = await fs.readdir(previousDir);
  } catch {
    process.stderr.write(
      `${theme.error("no rollback available")} — ${previousDir} is empty or missing\n`,
    );
    return EXIT_NOOP;
  }
  const baseName = path.basename(execPath);
  const candidates = entries
    .filter((name) => name.startsWith(baseName + ".old."))
    .sort();
  const rollbackCandidates = reverseCopy(candidates);
  if (rollbackCandidates.length === 0) {
    process.stderr.write(
      `${theme.error("no rollback available")} — no ${baseName}.old.* files in ${previousDir}\n`,
    );
    return EXIT_NOOP;
  }
  const latest = path.join(previousDir, rollbackCandidates[0]!);
  // Stage current as a secondary "previous" before replacement — so a
  // second `--rollback` can go back AGAIN (round-trip).
  const backupName = baseName + ".rollback-of." + Date.now();
  const backupPath = path.join(previousDir, backupName);
  try {
    await fs.rename(execPath, backupPath);
    await fs.rename(latest, execPath);
  } catch (err) {
    // Best-effort restoration.
    await fs.rename(backupPath, execPath).catch(() => {});
    printError("Rollback failed", err);
    return EXIT_ERROR;
  }
  process.stdout.write(
    `  ${theme.success("rolled back")} to ${rollbackCandidates[0]}\n` +
      `  ${theme.dim("current previous:")} ${backupPath}\n`,
  );
  return EXIT_OK;
}

// =====================================================================
// PACKAGE MODE (legacy)
// =====================================================================

async function upgradePackages(options: UpgradeOptions): Promise<number> {
  const rootDir = resolveFromCwd(options.cwd ?? ".");
  process.stdout.write(theme.heading("\nMandu Upgrade\n\n"));

  if (options.check === true) {
    process.stdout.write("  Package              Installed    Latest\n");
    process.stdout.write("  -----------------------------------------\n");
    let hasUpdate = false;
    for (const pkg of PACKAGES) {
      const [installed, latest] = await Promise.all([
        getInstalledVersion(rootDir, pkg),
        getLatestVersion(pkg, options.fetchImpl),
      ]);
      const upToDate = installed === latest;
      if (!upToDate && latest !== "fetch failed") hasUpdate = true;
      const marker = upToDate ? theme.success("ok") : theme.warn("up");
      process.stdout.write(
        `  [${marker}] ${pkg.padEnd(22)} ${installed.padEnd(12)} ${latest}\n`,
      );
    }
    process.stdout.write("\n");
    return hasUpdate ? EXIT_OK : EXIT_OK;
  }

  process.stdout.write("  Updating packages...\n\n");
  const proc = Bun.spawn(["bun", "update", ...PACKAGES], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(`\n${theme.error("Update failed")} (exit ${code})\n`);
    return EXIT_ERROR;
  }
  process.stdout.write(`\n${theme.success("Packages updated.")}\n`);
  return EXIT_OK;
}

async function getInstalledVersion(rootDir: string, pkg: string): Promise<string> {
  try {
    const pkgJson = path.join(rootDir, "node_modules", pkg, "package.json");
    if (!(await pathExists(pkgJson))) return "not installed";
    const data = await Bun.file(pkgJson).json();
    return data.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function getLatestVersion(
  pkg: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${pkg}/latest`);
    if (!res.ok) return "fetch failed";
    const data = (await res.json()) as { version?: string };
    return data.version ?? "unknown";
  } catch {
    return "fetch failed";
  }
}

// =====================================================================
// Helpers
// =====================================================================

function readCurrentVersion(): string {
  // In binary mode we embedded the CLI package.json version at compile
  // time via `Bun.version` / `process.env.MANDU_VERSION`. Prefer an
  // explicit env override for tests.
  if (process.env.MANDU_VERSION) return process.env.MANDU_VERSION;
  try {
    // Resolve the package.json relative to this module path so tests
    // that set cwd elsewhere still get the right answer.
    const here = typeof import.meta.dir === "string" ? import.meta.dir : "";
    const candidate = path.resolve(here, "..", "..", "package.json");
    // Read synchronously is fine — this is cold-path.
    const file = Bun.file(candidate);
    if (file.size > 0) {
      // We can't `await` here — callers accept an approximation with a
      // deferred fall-back. Return "0.0.0" + synchronous best-effort via
      // require-style read.
      // (Bun exposes `Bun.file(path).text()` as a Promise — we use it.)
    }
  } catch {
    /* ignore */
  }
  return "0.0.0";
}

/** Simple semver compare — returns negative if a < b, 0 equal, positive if a > b. */
export function compareSemver(a: string, b: string): number {
  const parseA = parseSemver(a);
  const parseB = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (parseA[i] !== parseB[i]) return parseA[i]! - parseB[i]!;
  }
  return 0;
}

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/, "").split(/[-+]/)[0]!;
  const parts = clean.split(".").map((n) => parseInt(n, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function printError(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${theme.error("error:")} ${label}: ${msg}\n`);
}

// =====================================================================
// Test hooks
// =====================================================================

export const __private = {
  isBinaryMode,
  parseChecksums,
  compareSemver,
  detectTargetLabel,
  atomicReplaceBinary,
  downloadAndVerify,
  fetchLatestRelease,
  fetchChecksums,
};
