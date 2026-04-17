/**
 * @mandujs/core/auth/verification — email verification flow (Phase 5.3).
 *
 * Flow:
 *   1. Caller collects an email at signup and invokes `send(userId, email)`.
 *   2. We mint a single-use token, render a link, and hand the rendered
 *      message to the caller's {@link EmailSender}.
 *   3. The user clicks the link. The landing route invokes
 *      `consume(tokenFromUrl)`.
 *   4. On success, `onVerified({ userId, email })` fires — the caller
 *      persists the "verified" flag on their user record.
 *
 * ## What this module does NOT do
 *
 * - **No user-record mutation.** We don't know what your `users` table
 *   looks like. The `onVerified` callback is your hook.
 * - **No auto-login.** Verification is an identity claim, not a session.
 *   If you want "verify and log in", do both in your landing route.
 * - **No rate limiting.** Caller must gate `send()` (suggested: 1/min per
 *   userId) to prevent outbound-email spam from a malicious attacker who
 *   knows someone's account id. Phase 6 rate-limit middleware can wrap
 *   this.
 * - **No storage side-effects on failed consume.** A bogus / expired token
 *   quietly returns `null` — do NOT log which check failed (would leak
 *   signal to brute-forcers).
 *
 * ## Idempotency caveat
 *
 * `consume()` marks the token used before invoking `onVerified`. If your
 * callback throws, the token is already consumed — the user would need a
 * fresh verification email. This is the safer trade-off: we'd rather
 * force a resend than leave a window where a single token can be
 * re-consumed and trigger `onVerified` twice. Make `onVerified` idempotent
 * so double-invocation (from a race elsewhere in your stack) is harmless.
 *
 * @example
 * ```ts
 * import { createEmailVerification } from "@mandujs/core/auth/verification";
 * import { createAuthTokenStore } from "@mandujs/core/auth/tokens"; // internal
 *
 * const store = createAuthTokenStore({ secret: process.env.TOKEN_SECRET! });
 * const verify = createEmailVerification({
 *   store,
 *   sender: mail,
 *   fromAddress: "noreply@example.com",
 *   verifyUrlTemplate: "https://app.example.com/verify?token={token}",
 *   renderEmail: ({ url }) => ({
 *     subject: "Verify your email",
 *     html: `<p>Click <a href="${url}">here</a>.</p>`,
 *   }),
 *   onVerified: async ({ userId, email }) => {
 *     await db.users.update(userId, { emailVerifiedAt: new Date(), email });
 *   },
 * });
 *
 * await verify.send("u-1", "alice@example.com");
 * // later, in the verify route:
 * const ok = await verify.consume(tokenFromQuery);
 * if (!ok) return ctx.badRequest("invalid or expired token");
 * ```
 *
 * @module auth/verification
 */

import type { EmailSender } from "../email/index.js";
import type { AuthTokenStore, TokenRecord } from "./tokens.js";

// ─── Public types ───────────────────────────────────────────────────────────

/** Construction options for {@link createEmailVerification}. */
export interface VerificationFlowOptions {
  /** Token store from {@link createAuthTokenStore}. */
  store: AuthTokenStore;
  /** Email transport. See `@mandujs/core/email` for provider options. */
  sender: EmailSender;
  /**
   * `From:` address stamped on every outbound verification message. Accepts
   * bare (`noreply@example.com`) or display-name (`"App <noreply@…>"`) form —
   * passed through to the provider, which does final validation.
   *
   * Required (no default) because a wrong `From:` on a transactional email
   * gets the entire domain flagged by the provider. The caller picks.
   */
  fromAddress: string;
  /**
   * URL template for the verification link. Must contain the literal
   * `{token}` placeholder — we substitute it with `encodeURIComponent(token)`
   * at send time.
   *
   * @example `"https://app.example.com/verify?token={token}"`
   */
  verifyUrlTemplate: string;
  /**
   * Render the email body. Returned object is forwarded to
   * {@link EmailSender.send} — `subject` is required; you must provide at
   * least one of `html` / `text`.
   */
  renderEmail: (args: {
    url: string;
    userId: string;
    email: string;
  }) => { subject: string; html?: string; text?: string };
  /**
   * Called after `consume()` marks a token used. Receives the verified
   * `{ userId, email }`. If this throws, the error propagates to the
   * `consume` caller — but the token is already consumed. Make this
   * idempotent.
   */
  onVerified: (args: { userId: string; email: string }) => Promise<void>;
}

/** Public surface returned by {@link createEmailVerification}. */
export interface VerificationFlow {
  /**
   * Mint a verification token, render the email with the link embedded,
   * and hand it off to the sender. Callers should rate-limit this per
   * userId — see Phase 6 rate-limit middleware.
   */
  send(userId: string, email: string): Promise<void>;
  /**
   * Consume a token. Returns `{ userId, email }` on success, `null` on any
   * failure mode (unknown / expired / already-used / tampered / wrong
   * purpose). Never throws on bad input.
   *
   * NOTE: if `onVerified` throws, the token is already consumed and the
   * error propagates. See the module-level "Idempotency caveat".
   */
  consume(token: string): Promise<{ userId: string; email: string } | null>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const URL_PLACEHOLDER = "{token}";
const PURPOSE = "verify-email" as const;

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Wire up an email-verification flow.
 *
 * @throws {TypeError} Synchronously when `verifyUrlTemplate` is missing the
 *   `{token}` placeholder, or when `fromAddress` is empty.
 */
export function createEmailVerification(
  options: VerificationFlowOptions,
): VerificationFlow {
  const { store, sender, fromAddress, verifyUrlTemplate, renderEmail, onVerified } =
    options;

  if (typeof fromAddress !== "string" || fromAddress.length === 0) {
    throw new TypeError(
      "[@mandujs/core/auth/verification] createEmailVerification: 'fromAddress' is required and must be a non-empty string.",
    );
  }
  if (typeof verifyUrlTemplate !== "string" || !verifyUrlTemplate.includes(URL_PLACEHOLDER)) {
    throw new TypeError(
      `[@mandujs/core/auth/verification] createEmailVerification: 'verifyUrlTemplate' must include the literal '${URL_PLACEHOLDER}' placeholder.`,
    );
  }

  async function send(userId: string, email: string): Promise<void> {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new TypeError(
        "[@mandujs/core/auth/verification] send: userId must be a non-empty string.",
      );
    }
    if (typeof email !== "string" || email.length === 0) {
      throw new TypeError(
        "[@mandujs/core/auth/verification] send: email must be a non-empty string.",
      );
    }

    // Persist the email-under-verification in `meta` so `consume()` can
    // surface it back to `onVerified`. The token itself binds to the userId
    // at the store level; `meta.email` is what the user is CLAIMING to
    // control at send time. They prove control by receiving the link.
    const { token } = await store.mint(PURPOSE, userId, { email });

    // Base64url-safe nonces mean `encodeURIComponent` is effectively a
    // no-op — we still wrap so a future nonce-alphabet change can't
    // silently produce broken URLs.
    const url = verifyUrlTemplate.replace(URL_PLACEHOLDER, encodeURIComponent(token));

    const rendered = renderEmail({ url, userId, email });
    if (!rendered || typeof rendered !== "object") {
      throw new TypeError(
        "[@mandujs/core/auth/verification] renderEmail: must return { subject, html?, text? }.",
      );
    }

    await sender.send({
      from: fromAddress,
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  async function consume(
    token: string,
  ): Promise<{ userId: string; email: string } | null> {
    // `parseToken` inside the store handles `null`/malformed input by
    // returning null — but our wire layer may have URL-encoded the token,
    // so reverse the encoding we applied in `send()` first. A malformed
    // %-sequence short-circuits to null (never throw on user input).
    const decoded = safeDecodeURIComponent(token);
    if (decoded === null) return null;

    const record = await store.consume(PURPOSE, decoded);
    if (!record) return null;

    const email = extractEmail(record);
    if (!email) {
      // Token was valid but the email is missing from meta — indicates a
      // store inconsistency (hand-edited row?). Treat as bogus rather than
      // invoking `onVerified` without an email.
      return null;
    }

    await onVerified({ userId: record.userId, email });
    return { userId: record.userId, email };
  }

  return { send, consume };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * `decodeURIComponent` throws on malformed `%XX`. User-supplied query
 * strings can carry bad encodings, so we wrap and normalise to null.
 */
function safeDecodeURIComponent(value: string): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Pull `email` from `record.meta`. Returns `null` when meta is missing or
 * the key is not a non-empty string. Defensive against a hand-edited DB
 * (or a future migration) where meta ends up with unexpected shape.
 */
function extractEmail(record: TokenRecord): string | null {
  const meta = record.meta;
  if (!meta || typeof meta !== "object") return null;
  const raw = meta.email;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}
