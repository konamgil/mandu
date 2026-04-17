/**
 * @mandujs/core/auth/reset — password-reset flow (Phase 5.3).
 *
 * Flow:
 *   1. Caller invokes `send(userId, email)` after verifying the email belongs
 *      to the account (typically via a "forgot password" form that looks up
 *      the user by email).
 *   2. We mint a single-use token, render a link, and hand the rendered
 *      message to the caller's {@link EmailSender}.
 *   3. The user clicks the link, enters a new password, and the landing
 *      route calls `consume(token, newPassword)`.
 *   4. On success, `onReset({ userId, newHash })` fires — the caller stores
 *      the new hash on their user record.
 *
 * ## Security shape
 *
 * - **No auto-login.** The user must re-authenticate with the new password.
 *   This is intentional: a reset token is a "please let me update my
 *   password" capability, not a session. If an attacker intercepts the
 *   link, we want them to still need to enter the new password they just
 *   set (which the legitimate user may immediately invalidate via a new
 *   reset). Auto-login would make the token a session bearer.
 * - **Plaintext never escapes the consume() boundary.** `onReset` receives
 *   only the argon2id hash (computed here via `hashPassword`). The
 *   plaintext is held briefly in consume's local scope; we do not log it
 *   and we don't forward it to any callback.
 * - **Token binds to userId, NOT to email.** Meta is empty on reset —
 *   unlike verification, the attacker already knows the email (they asked
 *   for the reset). What matters is that they control the inbox.
 * - **No rate limiting.** Caller must gate `send()` — a classic pattern is
 *   "1 reset request per minute per email AND per IP". Phase 6 middleware.
 *
 * ## Non-goals (handled by caller)
 *
 * - Invalidating existing sessions after a successful reset. If you want
 *   that, call `destroySession` on all sessions for `userId` from within
 *   your `onReset` callback (your session store's responsibility).
 * - Sending a "your password was changed" notification email. Recommended
 *   — do it in `onReset`.
 *
 * @example
 * ```ts
 * import { createPasswordReset } from "@mandujs/core/auth/reset";
 *
 * const reset = createPasswordReset({
 *   store,
 *   sender: mail,
 *   fromAddress: "noreply@example.com",
 *   resetUrlTemplate: "https://app.example.com/reset?token={token}",
 *   renderEmail: ({ url }) => ({
 *     subject: "Reset your password",
 *     html: `<p><a href="${url}">Reset password</a></p>`,
 *   }),
 *   onReset: async ({ userId, newHash }) => {
 *     await db.users.update(userId, { passwordHash: newHash });
 *   },
 * });
 *
 * await reset.send("u-1", "alice@example.com");
 * const ok = await reset.consume(tokenFromQuery, newPasswordFromForm);
 * if (!ok) return ctx.badRequest("invalid or expired token");
 * ```
 *
 * @module auth/reset
 */

import type { EmailSender } from "../email/index.js";
import { hashPassword, type PasswordOptions } from "./password.js";
import type { AuthTokenStore } from "./tokens.js";

// ─── Public types ───────────────────────────────────────────────────────────

/** Construction options for {@link createPasswordReset}. */
export interface ResetFlowOptions {
  /** Token store from {@link createAuthTokenStore}. */
  store: AuthTokenStore;
  /** Email transport. */
  sender: EmailSender;
  /**
   * `From:` address stamped on every outbound reset message. Required — see
   * the same rationale in `VerificationFlowOptions.fromAddress`.
   */
  fromAddress: string;
  /**
   * URL template for the reset link. Must include the literal `{token}`
   * placeholder.
   */
  resetUrlTemplate: string;
  /**
   * Render the email body. Returned object is forwarded to
   * {@link EmailSender.send} — `subject` required, at least one of
   * `html` / `text`.
   */
  renderEmail: (args: {
    url: string;
    userId: string;
    email: string;
  }) => { subject: string; html?: string; text?: string };
  /**
   * Password hashing options forwarded to `hashPassword`. Defaults to
   * argon2id with Bun's default cost. Override to set stricter cost
   * parameters for production, or for legacy bcrypt interop.
   */
  passwordOptions?: PasswordOptions;
  /**
   * Called after `consume()` marks a token used AND `hashPassword` has
   * returned the new hash. The caller persists `newHash` on the user
   * record. Safe to kick off session invalidation from here.
   */
  onReset: (args: { userId: string; newHash: string }) => Promise<void>;
}

/** Public surface returned by {@link createPasswordReset}. */
export interface ResetFlow {
  /** Mint a reset token and send the email. Rate-limit the caller. */
  send(userId: string, email: string): Promise<void>;
  /**
   * Consume a reset token and set a new password. Returns `{ userId }` on
   * success, `null` on any failure mode.
   *
   * Throws:
   *   - `TypeError` when `newPassword` is empty.
   *   - Errors from `hashPassword` (bcrypt 72-byte limit, missing Bun, etc.)
   *     — these run AFTER the token has been consumed. Your `onReset` is
   *     NOT invoked in that case; the caller should treat a thrown
   *     `hashPassword` as "token spent, ask for another reset".
   */
  consume(token: string, newPassword: string): Promise<{ userId: string } | null>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const URL_PLACEHOLDER = "{token}";
const PURPOSE = "reset-password" as const;

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Wire up a password-reset flow.
 *
 * @throws {TypeError} Synchronously when `resetUrlTemplate` is missing the
 *   `{token}` placeholder, or when `fromAddress` is empty.
 */
export function createPasswordReset(options: ResetFlowOptions): ResetFlow {
  const {
    store,
    sender,
    fromAddress,
    resetUrlTemplate,
    renderEmail,
    passwordOptions,
    onReset,
  } = options;

  if (typeof fromAddress !== "string" || fromAddress.length === 0) {
    throw new TypeError(
      "[@mandujs/core/auth/reset] createPasswordReset: 'fromAddress' is required and must be a non-empty string.",
    );
  }
  if (typeof resetUrlTemplate !== "string" || !resetUrlTemplate.includes(URL_PLACEHOLDER)) {
    throw new TypeError(
      `[@mandujs/core/auth/reset] createPasswordReset: 'resetUrlTemplate' must include the literal '${URL_PLACEHOLDER}' placeholder.`,
    );
  }

  async function send(userId: string, email: string): Promise<void> {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new TypeError(
        "[@mandujs/core/auth/reset] send: userId must be a non-empty string.",
      );
    }
    if (typeof email !== "string" || email.length === 0) {
      throw new TypeError(
        "[@mandujs/core/auth/reset] send: email must be a non-empty string.",
      );
    }

    // No meta — the email is not re-surfaced by consume (the caller
    // already knows the userId). Keeping meta empty keeps rows smaller and
    // reduces exposure if the DB leaks.
    const { token } = await store.mint(PURPOSE, userId);

    const url = resetUrlTemplate.replace(URL_PLACEHOLDER, encodeURIComponent(token));

    const rendered = renderEmail({ url, userId, email });
    if (!rendered || typeof rendered !== "object") {
      throw new TypeError(
        "[@mandujs/core/auth/reset] renderEmail: must return { subject, html?, text? }.",
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
    newPassword: string,
  ): Promise<{ userId: string } | null> {
    // Validate the password BEFORE consuming the token — a clear error
    // here means the user can retry with the same token. (If we consumed
    // first and then blew up on validation, they'd need a new reset email
    // for a fixable typo.)
    if (typeof newPassword !== "string" || newPassword.length === 0) {
      throw new TypeError(
        "[@mandujs/core/auth/reset] consume: newPassword must be a non-empty string.",
      );
    }

    const decoded = safeDecodeURIComponent(token);
    if (decoded === null) return null;

    const record = await store.consume(PURPOSE, decoded);
    if (!record) return null;

    // Token is spent. From here on, any error is propagated to the
    // caller — but the token cannot be retried. `hashPassword` throws on
    // the bcrypt 72-byte limit; we deliberately DO NOT catch that (the
    // test suite asserts the throw propagates).
    const newHash = await hashPassword(newPassword, passwordOptions);

    await onReset({ userId: record.userId, newHash });
    return { userId: record.userId };
  }

  return { send, consume };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeDecodeURIComponent(value: string): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
