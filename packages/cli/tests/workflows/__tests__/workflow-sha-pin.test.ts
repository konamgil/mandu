/**
 * Phase 11.A — GitHub Actions workflow integrity tests.
 *
 * Closes two Phase 9 audit items:
 *
 *   I-01  softprops/action-gh-release (and every other third-party action)
 *         must reference an immutable commit SHA, not a moving tag.
 *         Otherwise an upstream tag substitution could silently run
 *         attacker code with `GITHUB_TOKEN` + OIDC access.
 *
 *   M-01  release-binaries.yml must generate SLSA Build Level 2 attestations
 *         for every released artifact.
 *
 * The assertions are all **static text checks** — we deliberately do not
 * invoke `yamllint` or `actionlint` from these tests because those are
 * optional toolchain dependencies and the CI pipeline already runs them
 * at a higher level. What we verify here is the exact invariant that
 * changed in Phase 11.A.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

const WORKFLOW_FILES = [
  "release-binaries.yml",
  "ci.yml",
  "publish.yml",
] as const;

/** One action invocation extracted from a workflow file. */
interface ActionRef {
  file: string;
  line: number;
  raw: string; // the `uses: <owner>/<repo>@<ref>` text
  ref: string; // the part after `@`
}

/**
 * Parse every `uses: <owner>/<repo>@<ref>` line from a workflow file.
 *
 * Simple line-based scanner — avoids pulling a full YAML parser for a
 * single-attribute lookup. Safe because the `uses:` invariant is the same
 * across every GitHub Actions workflow by spec.
 */
function collectUses(filePath: string): ActionRef[] {
  const text = readFileSync(filePath, "utf-8");
  const out: ActionRef[] = [];
  const file = path.basename(filePath);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/uses:\s*([^@\s#]+)@(\S+)/);
    if (!match) continue;
    out.push({
      file,
      line: i + 1,
      raw: `${match[1]}@${match[2]}`,
      ref: match[2],
    });
  }
  return out;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MOVING_TAG_PATTERN = /^v\d+(\.\d+(\.\d+)?)?$/; // v4, v4.2, v4.2.1

describe("Phase 11.A workflow SHA pinning (I-01 fix)", () => {
  it("every third-party action in workflows pins to a 40-hex commit SHA", () => {
    const offenders: ActionRef[] = [];
    for (const wf of WORKFLOW_FILES) {
      const uses = collectUses(path.join(WORKFLOWS_DIR, wf));
      for (const ref of uses) {
        if (!SHA_PATTERN.test(ref.ref)) offenders.push(ref);
      }
    }
    if (offenders.length > 0) {
      const lines = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.raw}`)
        .join("\n");
      throw new Error(
        `Unpinned (non-SHA) GitHub Actions references:\n${lines}\n` +
          `Expected: owner/repo@<40-hex>  # vX`
      );
    }
  });

  it("no moving-tag references (v4, v2, main, master) remain", () => {
    const moving: ActionRef[] = [];
    for (const wf of WORKFLOW_FILES) {
      for (const ref of collectUses(path.join(WORKFLOWS_DIR, wf))) {
        if (
          MOVING_TAG_PATTERN.test(ref.ref) ||
          ref.ref === "main" ||
          ref.ref === "master"
        ) {
          moving.push(ref);
        }
      }
    }
    expect(moving).toEqual([]);
  });

  it("every pinned `uses:` line carries a trailing `# v<major>` comment", () => {
    // The SHA itself is authoritative; the trailing comment is purely
    // for human reviewers. If someone bumps a pin without updating the
    // comment, diff review becomes confusing.
    const offenders: Array<{ file: string; line: number; raw: string }> = [];
    for (const wf of WORKFLOW_FILES) {
      const full = readFileSync(path.join(WORKFLOWS_DIR, wf), "utf-8");
      const lines = full.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!/uses:\s*[^@\s#]+@[0-9a-f]{40}/.test(lines[i])) continue;
        if (!/#\s*v\d+/.test(lines[i])) {
          offenders.push({ file: wf, line: i + 1, raw: lines[i].trim() });
        }
      }
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.raw}`)
        .join("\n");
      throw new Error(
        `SHA-pinned uses: lines missing a human-readable version comment:\n${report}`
      );
    }
  });

  it("covers the expected set of third-party actions (sanity: >= 5 distinct)", () => {
    const owners = new Set<string>();
    for (const wf of WORKFLOW_FILES) {
      for (const ref of collectUses(path.join(WORKFLOWS_DIR, wf))) {
        owners.add(ref.raw.split("@")[0]);
      }
    }
    // Expected: actions/checkout, oven-sh/setup-bun, actions/upload-artifact,
    // actions/download-artifact, softprops/action-gh-release,
    // actions/attest-build-provenance.
    expect(owners.size).toBeGreaterThanOrEqual(5);
    for (const expected of [
      "actions/checkout",
      "oven-sh/setup-bun",
      "actions/upload-artifact",
      "actions/download-artifact",
      "softprops/action-gh-release",
      "actions/attest-build-provenance",
    ]) {
      expect(owners.has(expected)).toBe(true);
    }
  });
});

describe("Phase 11.A SLSA provenance wiring (M-01 first cut)", () => {
  it("release-binaries.yml declares id-token + attestations write permissions", () => {
    const text = readFileSync(
      path.join(WORKFLOWS_DIR, "release-binaries.yml"),
      "utf-8"
    );
    expect(text).toContain("id-token: write");
    expect(text).toContain("attestations: write");
  });

  it("release-binaries.yml runs actions/attest-build-provenance on every matrix leg", () => {
    const text = readFileSync(
      path.join(WORKFLOWS_DIR, "release-binaries.yml"),
      "utf-8"
    );
    expect(text).toMatch(/actions\/attest-build-provenance@[0-9a-f]{40}/);
    // The step must run inside the `build` job (before upload) so every
    // matrix target produces its own attestation.
    const attestIdx = text.indexOf("attest-build-provenance");
    const uploadIdx = text.indexOf("upload-artifact");
    expect(attestIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(attestIdx).toBeLessThan(uploadIdx);
  });

  it("docs/code-signing.md documents the SLSA Level 2 claim + vendor roadmap", () => {
    const text = readFileSync(
      path.join(REPO_ROOT, "docs", "code-signing.md"),
      "utf-8"
    );
    expect(text).toContain("SLSA Build Level 2");
    // At minimum, the two OS-vendor tracks must be acknowledged.
    expect(text).toContain("Azure Trusted Signing");
    expect(text).toContain("Apple Developer ID");
  });
});

describe("Phase 11.A workflow YAML shape (structural sanity)", () => {
  it("every workflow file declares a top-level `on:` trigger", () => {
    for (const wf of WORKFLOW_FILES) {
      const text = readFileSync(path.join(WORKFLOWS_DIR, wf), "utf-8");
      expect(text).toMatch(/^on:/m);
    }
  });

  it("every workflow file declares at least one job under `jobs:`", () => {
    for (const wf of WORKFLOW_FILES) {
      const text = readFileSync(path.join(WORKFLOWS_DIR, wf), "utf-8");
      expect(text).toMatch(/^jobs:/m);
    }
  });

  it("workflow files have no TAB characters (YAML requires spaces)", () => {
    for (const wf of WORKFLOW_FILES) {
      const text = readFileSync(path.join(WORKFLOWS_DIR, wf), "utf-8");
      expect(text.includes("\t")).toBe(false);
    }
  });
});
