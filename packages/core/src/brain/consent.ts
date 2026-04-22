/**
 * Brain — first-use consent prompt + cache (Issue #235).
 *
 * On the first `brain_doctor --useLLM` call that would dispatch to a
 * cloud adapter, Mandu prints a one-line summary of what will be
 * transmitted (diff excerpt, violation report shape, target model) and
 * prompts `y/N`. Consent is cached per-provider, per-project at
 * `~/.mandu/brain-consent.json` so the prompt only appears once.
 *
 * The CI escape hatch is `MANDU_BRAIN_AUTO_CONSENT=1` — used by
 * non-interactive pipelines that have already reviewed the data policy
 * out of band.
 *
 * Privacy invariants:
 *   - If consent is not granted, the adapter MUST fall through to the
 *     next tier in the resolver (ollama → template).
 *   - `telemetryOptOut: true` in config bypasses this module entirely —
 *     cloud adapters are never constructed in that case.
 *   - The consent cache only stores `{ providerId, projectFingerprint,
 *     grantedAt }`; no prompt content ever reaches this file.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const CONSENT_DIR = path.join(os.homedir(), ".mandu");
const CONSENT_FILE = path.join(CONSENT_DIR, "brain-consent.json");

export type ConsentProvider = "openai" | "anthropic";

export interface ConsentEntry {
  provider: ConsentProvider;
  /** SHA-256 of the absolute project root. Lets us re-prompt per-project. */
  project: string;
  /** ISO timestamp of the grant. */
  grantedAt: string;
  /** Model the user was informed about at grant time. */
  modelAtGrant: string;
}

export interface ConsentContext {
  /** Absolute path of the project root — identifies the consent scope. */
  projectRoot: string;
  provider: ConsentProvider;
  /** Model the adapter will transmit to — printed in the prompt. */
  model: string;
  /**
   * One-line human summary of the payload shape that will be sent.
   * Example: "Guard violation report (3 entries) + 120-line diff excerpt".
   * Adapters compose this from their prompt shape.
   */
  payloadDescription: string;
}

export interface ConsentPromptDeps {
  /** stdout writer — default process.stdout.write. Tests inject a stub. */
  write?: (msg: string) => void;
  /** Read one line of input. Tests inject a stub; production wraps readline. */
  ask?: (prompt: string) => Promise<string>;
  /** Environment — tests can force `MANDU_BRAIN_AUTO_CONSENT`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Fingerprint a project root so the cache key is collision-resistant
 * AND does not leak the absolute path to the on-disk file. We normalize
 * the path (lowercase on win32) before hashing so a case-variant path
 * resolves to the same entry.
 */
export function fingerprintProject(projectRoot: string): string {
  const normalized =
    process.platform === "win32" ? projectRoot.toLowerCase() : projectRoot;
  return createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 32);
}

async function readAllConsent(): Promise<ConsentEntry[]> {
  try {
    const raw = await fs.readFile(CONSENT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ConsentEntry[];
    return [];
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    return [];
  }
}

async function writeAllConsent(all: ConsentEntry[]): Promise<void> {
  await fs.mkdir(CONSENT_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONSENT_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  await fs.rename(tmp, CONSENT_FILE);
  try {
    await fs.chmod(CONSENT_FILE, 0o600);
  } catch {
    /* best-effort on Windows */
  }
}

/**
 * Check whether a (provider, project) pair already has stored consent.
 */
export async function hasConsent(
  provider: ConsentProvider,
  projectRoot: string,
): Promise<boolean> {
  const fp = fingerprintProject(projectRoot);
  const all = await readAllConsent();
  return all.some((e) => e.provider === provider && e.project === fp);
}

/**
 * Record consent for a (provider, project) pair. Idempotent.
 */
export async function grantConsent(
  ctx: ConsentContext,
): Promise<void> {
  const fp = fingerprintProject(ctx.projectRoot);
  const all = await readAllConsent();
  const existing = all.find(
    (e) => e.provider === ctx.provider && e.project === fp,
  );
  if (existing) return;
  all.push({
    provider: ctx.provider,
    project: fp,
    grantedAt: new Date().toISOString(),
    modelAtGrant: ctx.model,
  });
  await writeAllConsent(all);
}

/**
 * Revoke consent — used by `mandu brain logout --provider=...`.
 */
export async function revokeConsent(
  provider: ConsentProvider,
  projectRoot?: string,
): Promise<void> {
  const all = await readAllConsent();
  const fp = projectRoot ? fingerprintProject(projectRoot) : null;
  const next = all.filter((e) => {
    if (e.provider !== provider) return true;
    if (fp === null) return false; // revoke all projects for this provider
    return e.project !== fp;
  });
  await writeAllConsent(next);
}

/**
 * Ensure consent exists for the given context. Prompts the user if
 * necessary. Returns `true` when consent is granted (fresh or cached),
 * `false` when the user declined or non-interactive stdin is closed.
 *
 * Never throws — Brain is isolated from the Core execution path.
 */
export async function ensureConsent(
  ctx: ConsentContext,
  deps: ConsentPromptDeps = {},
): Promise<boolean> {
  const env = deps.env ?? process.env;

  // Already consented — fast path.
  if (await hasConsent(ctx.provider, ctx.projectRoot)) {
    return true;
  }

  // CI / pipeline opt-in.
  if (env.MANDU_BRAIN_AUTO_CONSENT === "1") {
    await grantConsent(ctx);
    return true;
  }

  const write = deps.write ?? ((m: string) => process.stdout.write(m));
  const ask = deps.ask ?? defaultReadLine;

  write(
    [
      "",
      "Mandu Brain — cloud adapter consent",
      "-----------------------------------",
      `  Provider : ${ctx.provider}`,
      `  Model    : ${ctx.model}`,
      `  Payload  : ${ctx.payloadDescription}`,
      "",
      "Secrets detected in source code are scrubbed before transmission",
      "(audit log: .mandu/brain-redactions.jsonl).",
      "",
      "Consent is cached per-project at ~/.mandu/brain-consent.json.",
      "Set MANDU_BRAIN_AUTO_CONSENT=1 in CI to skip this prompt.",
      "",
    ].join("\n"),
  );

  const answer = (await ask("Proceed? [y/N]: ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") {
    await grantConsent(ctx);
    return true;
  }
  return false;
}

/**
 * Default interactive reader — wraps node:readline. Returns an empty
 * string when stdin is non-TTY so non-interactive shells treat the
 * prompt as declined (safer default than auto-accepting).
 */
async function defaultReadLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  process.stdout.write(prompt);
  // Inline readline to avoid a top-level import — keeps the Brain
  // module graph small and avoids pulling readline into the SSR bundle.
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise<string>((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Consent file path — surfaced to the user in `mandu brain status`. */
export function consentFilePath(): string {
  return CONSENT_FILE;
}
