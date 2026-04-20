/**
 * Cron expression validation.
 *
 * `Bun.cron` and Cloudflare Workers Cron Triggers both accept standard 5-field
 * POSIX-style crontab expressions plus a handful of named aliases:
 *
 *   ┌───────────── minute        (0 - 59)
 *   │ ┌─────────── hour          (0 - 23)
 *   │ │ ┌───────── day of month  (1 - 31)
 *   │ │ │ ┌─────── month         (1 - 12) or Jan-Dec
 *   │ │ │ │ ┌───── day of week   (0 - 6)  or Sun-Sat (0 and 7 both = Sunday)
 *   │ │ │ │ │
 *   * * * * *
 *
 * Each field supports: `*`, lists (`1,2,3`), ranges (`1-5`), step values
 * (`*\/15`, `0-30/5`), and for month/day-of-week the named aliases. We keep
 * the validator *syntactic* — we don't try to catch logically impossible dates
 * (`31 2 *`) because cron runtimes silently skip them anyway and a too-strict
 * validator would reject expressions that work fine in production.
 *
 * Named aliases (non-standard but widely supported by vixie-cron, Bun, and
 * Cloudflare): `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`,
 * `@midnight`, `@hourly`. We permit these as a single-token input.
 */

const NAMED_ALIASES = new Set([
  "@yearly",
  "@annually",
  "@monthly",
  "@weekly",
  "@daily",
  "@midnight",
  "@hourly",
]);

const MONTH_NAMES = new Set([
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
]);

const DOW_NAMES = new Set([
  "sun", "mon", "tue", "wed", "thu", "fri", "sat",
]);

interface FieldSpec {
  min: number;
  max: number;
  /** Names this field accepts in place of numbers (lowercased). */
  names?: Set<string>;
}

const FIELDS: readonly FieldSpec[] = [
  { min: 0, max: 59 },                          // minute
  { min: 0, max: 23 },                          // hour
  { min: 1, max: 31 },                          // dom
  { min: 1, max: 12, names: MONTH_NAMES },      // month
  { min: 0, max: 7,  names: DOW_NAMES },        // dow (0 and 7 both = Sunday)
];

function resolveToken(token: string, spec: FieldSpec): number | null {
  const lower = token.toLowerCase();
  if (spec.names?.has(lower)) {
    // Return any number in range — we only care that the token is recognized.
    return spec.min;
  }
  if (!/^\d+$/.test(token)) return null;
  const n = Number(token);
  if (!Number.isFinite(n)) return null;
  if (n < spec.min || n > spec.max) return null;
  return n;
}

function validateField(field: string, spec: FieldSpec): boolean {
  if (field.length === 0) return false;

  // Split on commas for list form.
  const parts = field.split(",");
  for (const part of parts) {
    if (part.length === 0) return false;

    // Step form: `X/Y` or `*/Y` or `A-B/Y`.
    const [rangePart, stepPart] = part.split("/");
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return false;
      const step = Number(stepPart);
      if (step < 1) return false;
    }

    if (rangePart === "*") continue;

    // Range form: `A-B`.
    if (rangePart.includes("-")) {
      const [lo, hi] = rangePart.split("-");
      if (lo === undefined || hi === undefined) return false;
      const a = resolveToken(lo, spec);
      const b = resolveToken(hi, spec);
      if (a === null || b === null) return false;
      continue;
    }

    // Single token.
    if (resolveToken(rangePart, spec) === null) return false;
  }

  return true;
}

/**
 * Validate a cron expression at `defineCron` time. Throws with an actionable
 * error when the schedule is malformed, so the user sees the problem during
 * boot instead of a silent "job never fires".
 */
export function validateCronExpression(expr: string): void {
  if (typeof expr !== "string" || expr.trim().length === 0) {
    throw new Error(
      `[@mandujs/core/scheduler] invalid cron expression: expected a non-empty string (got: ${JSON.stringify(expr)}).`,
    );
  }

  const trimmed = expr.trim();

  // Named aliases are a single token.
  if (trimmed.startsWith("@")) {
    if (NAMED_ALIASES.has(trimmed.toLowerCase())) return;
    throw new Error(
      `[@mandujs/core/scheduler] invalid cron alias "${trimmed}". ` +
        `Supported aliases: ${[...NAMED_ALIASES].join(", ")}.`,
    );
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `[@mandujs/core/scheduler] invalid cron expression "${expr}" — ` +
        `expected 5 space-separated fields (minute hour day-of-month month day-of-week), got ${fields.length}.`,
    );
  }

  for (let i = 0; i < fields.length; i++) {
    if (!validateField(fields[i], FIELDS[i])) {
      const fieldNames = ["minute", "hour", "day-of-month", "month", "day-of-week"];
      throw new Error(
        `[@mandujs/core/scheduler] invalid cron expression "${expr}" — ` +
          `field #${i + 1} (${fieldNames[i]}): "${fields[i]}" is out of range or malformed.`,
      );
    }
  }
}

/**
 * Validate an IANA timezone string. Uses Intl.DateTimeFormat support detection
 * — the same approach the Temporal proposal recommends.
 */
export function validateTimezone(tz: string): void {
  if (typeof tz !== "string" || tz.length === 0) {
    throw new Error(
      `[@mandujs/core/scheduler] invalid timezone: expected a non-empty IANA string (got: ${JSON.stringify(tz)}).`,
    );
  }
  try {
    // `Intl.DateTimeFormat` throws `RangeError` for unknown zones.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(
      `[@mandujs/core/scheduler] unknown IANA timezone "${tz}". ` +
        `Examples: "UTC", "America/New_York", "Asia/Seoul".`,
    );
  }
}
