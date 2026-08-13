/**
 * @mandujs/core/email — SMTP adapter (stub)
 *
 * Intentionally not implemented in Phase 5.2. This file reserves the import
 * surface so that Phase 5.3 and downstream callers can write
 *
 *   import { createSmtpSender } from "@mandujs/core/compat/email/index";
 *
 * and decide at runtime whether to fall back to `createResendSender` or
 * `createMemoryEmailSender`. Calling the factory throws a clear, actionable
 * error — never a silent no-op.
 *
 * ## Design note (v0.2 plan)
 *
 * The planned implementation has two viable paths:
 *
 *  1. **Bun-native** — open a TCP socket with `Bun.connect()`, upgrade to
 *     TLS via `Bun.connect({ tls: true })` (or `STARTTLS` on port 587),
 *     then speak the SMTP state machine by hand: `EHLO` → `AUTH LOGIN`
 *     (base64 user / pass) → `MAIL FROM` → `RCPT TO` (×n) → `DATA` → CRLF
 *     dot-stuffed body → `.` → `QUIT`. This keeps the zero-deps promise
 *     and matches the rest of the package's Bun-native posture. Total
 *     ≈ 300 LOC; the RFC 5321 happy path is small, it's the edge cases
 *     (pipelining, CHUNKING, 8BITMIME negotiation, XOAUTH2, line folding
 *     at 998 chars) that balloon the complexity.
 *
 *  2. **nodemailer as a peer dep** — battle-tested, handles every edge
 *     case. Trade-off: drops "zero deps" for this adapter, and nodemailer
 *     is CommonJS-heavy. We'd wire it as an optional peer so apps only
 *     take the hit if they opt in.
 *
 * Current leaning: start with path (1) for a constrained feature set (TLS
 * on 465, AUTH PLAIN/LOGIN, single-recipient per RCPT, no attachments),
 * escape-hatch to (2) if we hit providers that need the full RFC. Either
 * path must preserve the `EmailSender` contract with no behavioural drift
 * vs the Resend adapter (same validation, same error shape).
 *
 * @module email/smtp
 */

import type { EmailSender } from "./index.js";

/** Config for the (not-yet-implemented) SMTP adapter. */
export interface SmtpOptions {
  host: string;
  port?: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
}

/**
 * Throws at call time. The adapter is planned for v0.2.
 *
 * @throws Always. Use {@link createResendSender} or
 *   {@link createMemoryEmailSender} instead.
 */
export function createSmtpSender(_options: SmtpOptions): EmailSender {
  // TODO(phase-5.2+): implement via Bun.connect() + TLS upgrade, OR wire
  // nodemailer as an optional peer dep. See module-level JSDoc for the
  // design trade-off.
  throw new Error(
    "[@mandujs/core/email/smtp] Phase 5.2: SMTP adapter is planned but not yet implemented. Use createResendSender or createMemoryEmailSender.",
  );
}
