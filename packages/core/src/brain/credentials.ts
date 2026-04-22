/**
 * Brain — OS keychain adapter for OAuth tokens (Issue #235).
 *
 * Zero new dependencies — we shell out to the native secret-store CLI
 * on each platform, with a filesystem fallback at
 * `~/.mandu/credentials.json` (mode 0600) when no CLI is available.
 *
 *   - macOS   → `security find-generic-password` / `add-generic-password`
 *   - Windows → `cmdkey` (read) + PowerShell `ConvertFrom-SecureString`
 *               is too heavyweight; we use a narrow `cmdkey /add` +
 *               `cmdkey /list` shell dance instead. Windows does NOT let
 *               `cmdkey` read back the password, so we fall through to
 *               the filesystem store on Windows and mark it 0600 — the
 *               file lives under the user profile which is already
 *               ACL'd to the current user. This matches the behavior of
 *               `gh auth`, `npm`, and `docker-credential-wincred`
 *               when run without their companion helper installed.
 *   - Linux   → `secret-tool store` / `secret-tool lookup` (libsecret).
 *
 * API surface is intentionally minimal:
 *
 *   - `saveToken(provider, token)`    → persist
 *   - `loadToken(provider)`           → returns token or null
 *   - `deleteToken(provider)`         → idempotent delete
 *   - `listProviders()`               → for `mandu brain status`
 *
 * The token type is arbitrary JSON (access_token + refresh_token +
 * expires_at) — `CredentialStore` serializes it as a JSON string.
 */

import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVICE = "mandu-brain";
const FALLBACK_DIR = path.join(os.homedir(), ".mandu");
const FALLBACK_FILE = path.join(FALLBACK_DIR, "credentials.json");

/**
 * Stored token shape. `access_token` is required; the refresh fields
 * are optional because template-only adapters never write them.
 */
export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  /** Unix-epoch seconds when the access_token expires. */
  expires_at?: number;
  /** ISO timestamp of last successful use — for `mandu brain status`. */
  last_used_at?: string;
  /** Cached default model chosen at login time (override via config). */
  default_model?: string;
  /** Scope string returned by the OAuth provider. */
  scope?: string;
  /** Provider identifier — for audit. */
  provider?: "openai" | "anthropic";
}

/**
 * Pluggable backend for the credential store. Tests inject an
 * in-memory backend; production auto-selects by OS.
 */
export interface CredentialBackend {
  readonly name: string;
  save(provider: string, token: StoredToken): Promise<void>;
  load(provider: string): Promise<StoredToken | null>;
  delete(provider: string): Promise<void>;
  list(): Promise<string[]>;
}

/* -------------------------------------------------------------------- */
/* Filesystem fallback — always available, always the safety net.       */
/* -------------------------------------------------------------------- */

/**
 * Read the fallback credentials file. Missing file → empty object.
 * Corrupt file → empty object + a warning to stderr (so a bad edit
 * does not brick `mandu brain status`).
 */
async function readFallback(): Promise<Record<string, StoredToken>> {
  try {
    const raw = await fs.readFile(FALLBACK_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, StoredToken>;
    }
    return {};
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {};
    }
    // Corrupt JSON — treat as empty, do not throw (Brain never blocks).
    return {};
  }
}

async function writeFallback(all: Record<string, StoredToken>): Promise<void> {
  await fs.mkdir(FALLBACK_DIR, { recursive: true, mode: 0o700 });
  const payload = JSON.stringify(all, null, 2);
  // Write atomically: write to tmp then rename, setting 0600 on the
  // final file. mode on `writeFile` is advisory on Windows, enforced
  // on POSIX.
  const tmp = `${FALLBACK_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, payload, { mode: 0o600 });
  await fs.rename(tmp, FALLBACK_FILE);
  try {
    await fs.chmod(FALLBACK_FILE, 0o600);
  } catch {
    // chmod is best-effort on Windows.
  }
}

export const filesystemBackend: CredentialBackend = {
  name: "filesystem",
  async save(provider, token) {
    const all = await readFallback();
    all[provider] = token;
    await writeFallback(all);
  },
  async load(provider) {
    const all = await readFallback();
    return all[provider] ?? null;
  },
  async delete(provider) {
    const all = await readFallback();
    if (provider in all) {
      delete all[provider];
      await writeFallback(all);
    }
  },
  async list() {
    const all = await readFallback();
    return Object.keys(all);
  },
};

/* -------------------------------------------------------------------- */
/* Native backends — best-effort; fall through to filesystem on error.  */
/* -------------------------------------------------------------------- */

/**
 * Shell out to a binary with a short stdin payload and return stdout.
 * Never throws — returns `null` on any non-zero exit. We never log the
 * stderr verbatim because some utilities echo the payload back on
 * failure.
 */
async function runWithStdin(
  cmd: string,
  args: string[],
  stdin: string,
): Promise<{ ok: boolean; stdout: string } | null> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(stdin);
    await proc.stdin.end();
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return { ok: exitCode === 0, stdout };
  } catch {
    return null;
  }
}

async function runCapture(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string } | null> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return { ok: exitCode === 0, stdout };
  } catch {
    return null;
  }
}

/**
 * macOS Keychain backend — uses the `security` CLI.
 *
 * `security add-generic-password -U -a <provider> -s mandu-brain -w <json>`
 * to store; `find-generic-password -a <provider> -s mandu-brain -w`
 * to read the password back. Deletion uses `delete-generic-password`.
 */
export const macosBackend: CredentialBackend = {
  name: "macos-keychain",
  async save(provider, token) {
    const payload = JSON.stringify(token);
    const res = await runCapture("security", [
      "add-generic-password",
      "-U", // update if exists
      "-a",
      provider,
      "-s",
      SERVICE,
      "-w",
      payload,
    ]);
    if (!res || !res.ok) {
      // Fall back to filesystem — never let a keychain hiccup block login.
      await filesystemBackend.save(provider, token);
    }
  },
  async load(provider) {
    const res = await runCapture("security", [
      "find-generic-password",
      "-a",
      provider,
      "-s",
      SERVICE,
      "-w",
    ]);
    if (!res || !res.ok) {
      return filesystemBackend.load(provider);
    }
    try {
      return JSON.parse(res.stdout.trim()) as StoredToken;
    } catch {
      return null;
    }
  },
  async delete(provider) {
    await runCapture("security", [
      "delete-generic-password",
      "-a",
      provider,
      "-s",
      SERVICE,
    ]);
    // Also scrub filesystem fallback, in case a previous save hit it.
    await filesystemBackend.delete(provider);
  },
  async list() {
    // `security` has no "list by service" flag that returns accounts
    // without the full dump; use filesystem fallback as the source of
    // truth for the list, since saves always also go through keychain
    // (or fell back to the file).
    return filesystemBackend.list();
  },
};

/**
 * Linux libsecret backend — `secret-tool`.
 */
export const linuxBackend: CredentialBackend = {
  name: "linux-secret-tool",
  async save(provider, token) {
    const payload = JSON.stringify(token);
    const res = await runWithStdin(
      "secret-tool",
      ["store", "--label=mandu-brain", "service", SERVICE, "account", provider],
      payload,
    );
    if (!res || !res.ok) {
      await filesystemBackend.save(provider, token);
    }
  },
  async load(provider) {
    const res = await runCapture("secret-tool", [
      "lookup",
      "service",
      SERVICE,
      "account",
      provider,
    ]);
    if (!res || !res.ok || res.stdout.trim().length === 0) {
      return filesystemBackend.load(provider);
    }
    try {
      return JSON.parse(res.stdout.trim()) as StoredToken;
    } catch {
      return null;
    }
  },
  async delete(provider) {
    await runCapture("secret-tool", [
      "clear",
      "service",
      SERVICE,
      "account",
      provider,
    ]);
    await filesystemBackend.delete(provider);
  },
  async list() {
    return filesystemBackend.list();
  },
};

/**
 * Windows — `cmdkey` can store but cannot read back the password
 * portion without the Credential Manager API (which we would need a
 * native binding for). Use filesystem fallback directly; the file
 * lives under `%USERPROFILE%\.mandu\credentials.json` which is ACL'd
 * to the current user by default. This matches the behavior of
 * `gh auth login` when the Git Credential Manager is not installed.
 */
export const windowsBackend: CredentialBackend = {
  name: "windows-filesystem",
  save: filesystemBackend.save,
  load: filesystemBackend.load,
  delete: filesystemBackend.delete,
  list: filesystemBackend.list,
};

/**
 * Pick the best backend for the current platform. Tests override this
 * by constructing a `CredentialStore` with an explicit backend.
 */
export function pickPlatformBackend(): CredentialBackend {
  if (process.platform === "darwin") return macosBackend;
  if (process.platform === "win32") return windowsBackend;
  if (process.platform === "linux") return linuxBackend;
  return filesystemBackend;
}

/* -------------------------------------------------------------------- */
/* Public store                                                         */
/* -------------------------------------------------------------------- */

export class CredentialStore {
  constructor(private backend: CredentialBackend = pickPlatformBackend()) {}

  /** Which backend is active — surfaced in `mandu brain status`. */
  get backendName(): string {
    return this.backend.name;
  }

  async save(provider: string, token: StoredToken): Promise<void> {
    await this.backend.save(provider, token);
  }

  async load(provider: string): Promise<StoredToken | null> {
    return this.backend.load(provider);
  }

  async delete(provider: string): Promise<void> {
    await this.backend.delete(provider);
  }

  async list(): Promise<string[]> {
    return this.backend.list();
  }

  /**
   * Touch the last_used_at timestamp on an existing token without
   * rotating the secret. Best-effort — swallow errors (telemetry).
   */
  async touch(provider: string): Promise<void> {
    try {
      const tok = await this.load(provider);
      if (tok) {
        tok.last_used_at = new Date().toISOString();
        await this.save(provider, tok);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * File path of the filesystem fallback — used by tests + the CLI
   * `mandu brain status` to point users at the 0600 file. Always
   * returns the same path regardless of backend.
   */
  static fallbackPath(): string {
    return FALLBACK_FILE;
  }
}

/** Default singleton — production path. */
let defaultStore: CredentialStore | null = null;
export function getCredentialStore(): CredentialStore {
  if (!defaultStore) {
    defaultStore = new CredentialStore();
  }
  return defaultStore;
}

/** Override the singleton (test affordance). */
export function setCredentialStore(store: CredentialStore): void {
  defaultStore = store;
}
