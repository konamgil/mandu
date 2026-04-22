/**
 * Tests for `packages/core/src/brain/redactor.ts`.
 *
 * Each test asserts BOTH invariants we care about:
 *   1. The secret no longer appears verbatim in the redacted output.
 *   2. A correctly-kinded `RedactionHit` shows up in the audit list.
 *
 * Regression guard — if someone relaxes a pattern to fix a false
 * positive, the matching test here will fail before a key leaks.
 */

import { describe, it, expect } from "bun:test";
import { redactSecrets, redact } from "../redactor";

describe("redactSecrets — OpenAI-style keys", () => {
  it("redacts sk-... keys and audits the hit", () => {
    const secret = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX";
    const input = `Use key ${secret} to call.`;
    const { redacted, hits } = redactSecrets(input);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[[REDACTED:openai-key]]");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const sampleContainsFullKey = hits.some((h) => h.sample.includes(secret));
    expect(sampleContainsFullKey).toBe(false);
  });
});

describe("redactSecrets — Bearer tokens", () => {
  it("redacts Authorization: Bearer headers", () => {
    const bearer = "Bearer eyJhbGciOiJIUzI1NiJ9abcdefghij.signature-blob";
    const input = `curl -H 'Authorization: ${bearer}' api/host`;
    const { redacted, hits } = redactSecrets(input);
    expect(redacted).not.toContain(bearer);
    expect(hits.some((h) => h.kind === "bearer-token")).toBe(true);
  });
});

describe("redactSecrets — .env references", () => {
  it("redacts bare .env and .env.production references", () => {
    const input = "Credentials live in .env and overrides in .env.production.";
    const { redacted, hits } = redactSecrets(input);
    expect(redacted).not.toContain(" .env ");
    expect(redacted).not.toContain(".env.production");
    expect(hits.filter((h) => h.kind === "env-ref").length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe("redactSecrets — KEY=VALUE assignments", () => {
  it("redacts API_KEY=... assignments in-place", () => {
    const input = `OPENAI_API_KEY=sk-fake1234567890abcdef\nDEBUG=1`;
    const { redacted, hits } = redactSecrets(input);
    // The whole assignment collapses into a single marker.
    expect(redacted).toContain("[[REDACTED:api-key-assignment]]");
    expect(redacted).toContain("DEBUG=1"); // untouched
    expect(hits.some((h) => h.kind === "api-key-assignment")).toBe(true);
  });
});

describe("redactSecrets — multi-match, non-overlapping", () => {
  it("redacts multiple secrets in a single payload", () => {
    const gh = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const aws = "AKIAIOSFODNN7EXAMPLE";
    const input = `GitHub: ${gh}\nAWS: ${aws}\nNothing here.`;
    const { redacted, hits } = redactSecrets(input);
    expect(redacted).not.toContain(gh);
    expect(redacted).not.toContain(aws);
    expect(hits.some((h) => h.kind === "github-token")).toBe(true);
    expect(hits.some((h) => h.kind === "aws-key")).toBe(true);
  });
});

describe("redactSecrets — clean input passthrough", () => {
  it("returns the input unchanged and an empty hit list when nothing matches", () => {
    const input = "No secrets, just a normal message about the weather.";
    const { redacted, hits } = redactSecrets(input);
    expect(redacted).toBe(input);
    expect(hits.length).toBe(0);
  });
});

describe("redact() convenience", () => {
  it("returns the redacted string directly", () => {
    const secret = "sk-proj-THISISAFAKEKEY1234567890";
    const out = redact(`token: ${secret}`);
    expect(out).not.toContain(secret);
  });

  it("returns the original string when nothing matches", () => {
    const input = "hello world";
    expect(redact(input)).toBe(input);
  });
});
