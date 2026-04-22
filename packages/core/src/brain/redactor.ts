/**
 * Brain — pre-transmission secret redactor (Issue #235)
 *
 * Every payload destined for a cloud adapter is passed through
 * `redactSecrets()` FIRST. The function returns:
 *
 *   - `{ redacted, hits }` — redacted payload + list of what matched, so
 *     the CLI / adapter can print an audit line and append to
 *     `.mandu/brain-redactions.jsonl` for user inspection.
 *
 * Design principles (user feedback — Mandu as connector, not owner):
 *   - Mandu NEVER transmits a prompt without passing it through here.
 *   - Patterns are conservative (false positives preferred over leaks).
 *   - No regex is anchored; we scan the full text so embedded secrets
 *     inside a diff block are still caught.
 *   - All replacements collapse to a single token `[[REDACTED:<kind>]]`
 *     so the cloud model sees a stable shape rather than a mangled
 *     partial key that could still be reconstructed.
 *
 * @see docs/brain/oauth-adapters.md (if that ever ships — for now this
 *   file + its tests are the source of truth).
 */
export type RedactionKind =
  | "openai-key"
  | "stripe-key"
  | "github-token"
  | "slack-token"
  | "aws-key"
  | "bearer-token"
  | "env-ref"
  | "api-key-assignment"
  | "jwt"
  | "long-base64";

export interface RedactionHit {
  /** The kind of secret matched (for audit logging). */
  kind: RedactionKind;
  /** Byte offset into the original input where the match started. */
  start: number;
  /** Byte offset into the original input where the match ended. */
  end: number;
  /**
   * Short sample of the redacted material — always prefix + ellipsis,
   * never the full secret. Safe to log.
   */
  sample: string;
}

export interface RedactionResult {
  /** Input with every match replaced by `[[REDACTED:<kind>]]`. */
  redacted: string;
  /** One entry per match, in scan order. */
  hits: RedactionHit[];
}

/**
 * Ordered pattern list. Earlier patterns win — specific formats (e.g.
 * `sk-...`) are checked before the generic "long base64" fallback so
 * their `kind` tag is accurate.
 *
 * Every pattern is intentionally over-conservative — we would rather
 * redact a false-positive hash than leak a real key. Users can inspect
 * `.mandu/brain-redactions.jsonl` to spot over-redaction.
 */
const PATTERNS: Array<{ kind: RedactionKind; regex: RegExp }> = [
  // OpenAI-style keys: sk-XXXX, sk-proj-XXXX, pk-XXXX.
  { kind: "openai-key", regex: /\b(?:sk|pk)-(?:proj-)?[A-Za-z0-9_\-]{16,}\b/g },
  // Stripe live/test keys.
  { kind: "stripe-key", regex: /\brk_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // GitHub PATs — ghp_, gho_, ghu_, ghs_, ghr_.
  { kind: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  // Slack bot / user tokens.
  { kind: "slack-token", regex: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g },
  // AWS access key id (fixed-width 20 char uppercase starting w/ AKIA / ASIA).
  { kind: "aws-key", regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  // Authorization: Bearer ...
  {
    kind: "bearer-token",
    regex: /(?:Authorization:\s*)?\bBearer\s+[A-Za-z0-9._\-]{16,}/gi,
  },
  // `.env` path references — we redact the path itself, not the
  // surrounding sentence. "see .env" → "see [[REDACTED:env-ref]]".
  // Trailing lookahead matches sentence punctuation / whitespace /
  // end-of-string so "see .env." / ".env.production." both redact.
  { kind: "env-ref", regex: /\.env(?:\.[a-z]+)?(?=[\s,.;:!?'")`]|$)/g },
  // KEY="value" / KEY=value assignments, where KEY contains
  // API_KEY/SECRET/TOKEN/PASSWORD. Matches the whole assignment.
  {
    kind: "api-key-assignment",
    regex:
      /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*\s*=\s*["']?[^\s"'\n]+["']?/g,
  },
  // JWTs (three base64url segments separated by dots).
  {
    kind: "jwt",
    regex: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g,
  },
  // Generic long base64/hex blob (20+ chars, mixed case or digit-heavy).
  // Runs last so more specific kinds claim first.
  {
    kind: "long-base64",
    regex: /\b[A-Za-z0-9+/=_\-]{24,}\b/g,
  },
];

/**
 * Sample a match for audit logging — never return the full secret.
 *
 * Returns `"<first 4 chars>...<last 2 chars>"` for entries longer
 * than 8 characters, and a hard-coded stub otherwise. The sample is
 * deliberately short so it cannot be used to reconstruct the key.
 */
function sampleOf(match: string): string {
  if (match.length <= 8) return "***";
  return `${match.slice(0, 4)}...${match.slice(-2)}`;
}

/**
 * Scan `input` for secrets and return a redacted copy + hit list.
 *
 * The scan is non-overlapping: once a region is claimed by an earlier
 * pattern, later patterns cannot match inside it. This is enforced by
 * walking the hit set and rebuilding the string in one pass rather than
 * running `.replace()` per-pattern (which would allow the generic
 * "long-base64" to fire on the already-inserted `[[REDACTED:...]]`
 * marker).
 *
 * @param input Raw text about to be transmitted to a cloud adapter.
 * @returns Redacted text plus audit-safe hit list.
 */
export function redactSecrets(input: string): RedactionResult {
  if (!input || input.length === 0) {
    return { redacted: input ?? "", hits: [] };
  }

  // 1. Collect every candidate hit across every pattern.
  const raw: RedactionHit[] = [];
  for (const { kind, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(input)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      raw.push({
        kind,
        start: m.index,
        end: m.index + m[0].length,
        sample: sampleOf(m[0]),
      });
    }
  }

  if (raw.length === 0) {
    return { redacted: input, hits: [] };
  }

  // 2. Sort by start offset; on tie prefer the earlier pattern (which
  // means the more specific kind since PATTERNS is ordered).
  raw.sort((a, b) => (a.start - b.start) || (a.end - b.end));

  // 3. Greedy non-overlap: keep the first match; skip anything that
  // starts before the last accepted match ended.
  const accepted: RedactionHit[] = [];
  let cursor = -1;
  for (const h of raw) {
    if (h.start < cursor) continue;
    accepted.push(h);
    cursor = h.end;
  }

  // 4. Rebuild the output in one pass.
  let out = "";
  let i = 0;
  for (const h of accepted) {
    out += input.slice(i, h.start);
    out += `[[REDACTED:${h.kind}]]`;
    i = h.end;
  }
  out += input.slice(i);

  return { redacted: out, hits: accepted };
}

/**
 * Convenience — returns only the redacted string.
 *
 * Use `redactSecrets()` directly when you also need the hit list (for
 * audit logging). Use this when you just want "scrub and forward".
 */
export function redact(input: string): string {
  return redactSecrets(input).hits.length === 0
    ? input
    : redactSecrets(input).redacted;
}
