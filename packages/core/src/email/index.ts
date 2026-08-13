/**
 * @mandujs/core/email
 *
 * Minimal transactional-email primitive: an `EmailSender` interface and two
 * concrete adapters (`memory`, `resend`). Authentication flows (Phase 5.3 —
 * email verification, password reset) consume this interface; they do not
 * care which provider is wired up.
 *
 * Design constraints:
 *   - **No external deps.** The resend adapter speaks HTTP via `fetch`.
 *   - **Send-only.** No MIME parsing inbound, no attachments (deferred to v2),
 *     no templating — callers build their own HTML.
 *   - **No queue / retry.** The caller (or a job runner) owns retries. This
 *     module is a transport primitive, not a mail pipeline.
 *   - **SMTP is stubbed.** See {@link ./smtp.ts} for the planned design.
 *
 * @example
 * ```ts
 * import { createResendSender } from "@mandujs/core/compat/email/index";
 *
 * const mail = createResendSender({ apiKey: process.env.RESEND_API_KEY! });
 * await mail.send({
 *   from: "Mandu <no-reply@mandu.dev>",
 *   to: "user@example.com",
 *   subject: "Verify your email",
 *   html: "<p>Click <a href=\"...\">here</a> to verify.</p>",
 * });
 * ```
 *
 * @example Tests — swap in the memory adapter:
 * ```ts
 * import { createMemoryEmailSender } from "@mandujs/core/compat/email/index";
 *
 * const mail = createMemoryEmailSender();
 * await handler({ mail });            // your code under test
 * await mail.waitFor(1);              // race-free assertion
 * expect(mail.sent[0].subject).toBe("Verify your email");
 * ```
 *
 * @module email
 */

import { newId } from "../id/index.js";

// ─── Public types ───────────────────────────────────────────────────────────

/** A single outbound message. At least one of `html` / `text` is required. */
export interface EmailMessage {
  /**
   * Sender address. Accepted forms:
   *   - `"sender@domain.com"`
   *   - `"Display Name <sender@domain.com>"`
   */
  from: string;
  /** Single address or an array of addresses (≥ 1). */
  to: string | string[];
  /** Non-empty subject line. */
  subject: string;
  /** HTML body. Required if `text` is absent. */
  html?: string;
  /** Plain-text body. Required if `html` is absent. */
  text?: string;
  /** CC recipients (optional). */
  cc?: string | string[];
  /** BCC recipients (optional). */
  bcc?: string | string[];
  /** Reply-To address (optional). Mapped to `reply_to` on provider payloads. */
  replyTo?: string;
  /**
   * Arbitrary provider-specific headers. Keys are lowercased before being
   * forwarded to the provider. Non-ASCII values may be rejected by the
   * provider — we do not validate here.
   */
  headers?: Record<string, string>;
}

/** Result of a successful send. */
export interface EmailSendResult {
  /** Provider's message id. For the memory adapter, a synthetic UUIDv7. */
  id: string;
  /** Unix ms when the send call settled. */
  sentAt: number;
}

/** Abstract transport. */
export interface EmailSender {
  /**
   * Sends a single message. Throws:
   *   - `TypeError` on validation failure (malformed message shape).
   *   - `Error` with status/context on transport failure (non-2xx, network).
   */
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** In-process adapter for tests + dev. Single-process only — NOT distributed. */
export interface MemoryEmailSender extends EmailSender {
  /** All messages sent since construction. Read-only, order preserved. */
  readonly sent: ReadonlyArray<EmailMessage & { id: string; sentAt: number }>;
  /** Empty the spool. Useful between test cases. */
  clear(): void;
  /**
   * Resolves once `sent.length >= n`. Rejects after `timeoutMs`. Useful for
   * tests that race with a request handler.
   *
   * @param n Target count. Default 1.
   * @param timeoutMs Abort threshold in ms. Default 1000.
   */
  waitFor(n?: number, timeoutMs?: number): Promise<void>;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Accepts either a bare address (`"a@b.com"`) or display-name form
 * (`"Name <a@b.com>"`). We deliberately do NOT implement RFC 5322 — that
 * regex is famously 6kB and still imperfect. The provider will reject
 * addresses it doesn't like.
 */
const BARE_EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const DISPLAY_NAME_RE = /^.+\s<[^\s@]+@[^\s@]+>$/;

function isValidFrom(from: string): boolean {
  if (typeof from !== "string" || from.length === 0) return false;
  return BARE_EMAIL_RE.test(from) || DISPLAY_NAME_RE.test(from);
}

function normalizeRecipients(
  value: string | string[] | undefined,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.length > 0 ? [value] : [];
  return value;
}

/**
 * Validates `message` shape. Throws `TypeError` on the first problem found.
 *
 * Exported for tests and for callers who want to pre-check a message before
 * enqueueing it.
 *
 * @internal
 */
export function _validateMessage(message: EmailMessage): void {
  if (!message || typeof message !== "object") {
    throw new TypeError("[@mandujs/core/email] send: message must be an object.");
  }

  if (!isValidFrom(message.from)) {
    throw new TypeError(
      `[@mandujs/core/email] send: 'from' must be an email address or "Name <addr>" form (got ${JSON.stringify(
        message.from,
      )}).`,
    );
  }

  const to = normalizeRecipients(message.to);
  if (!to || to.length === 0) {
    throw new TypeError(
      "[@mandujs/core/email] send: 'to' must be a non-empty string or non-empty array.",
    );
  }
  for (const addr of to) {
    if (typeof addr !== "string" || addr.length === 0) {
      throw new TypeError(
        "[@mandujs/core/email] send: 'to' entries must be non-empty strings.",
      );
    }
  }

  if (typeof message.subject !== "string" || message.subject.length === 0) {
    throw new TypeError(
      "[@mandujs/core/email] send: 'subject' must be a non-empty string.",
    );
  }

  const hasHtml = typeof message.html === "string" && message.html.length > 0;
  const hasText = typeof message.text === "string" && message.text.length > 0;
  if (!hasHtml && !hasText) {
    throw new TypeError(
      "[@mandujs/core/email] send: message must include at least one of 'html' or 'text'.",
    );
  }
}

/**
 * Shared coercion used by provider adapters: turn a `EmailMessage` into a
 * `{ to, cc, bcc }` bundle of string arrays for the provider payload. Omits
 * undefined-valued fields entirely so the provider doesn't see `null`s.
 *
 * @internal
 */
export function _coerceRecipients(message: EmailMessage): {
  to: string[];
  cc?: string[];
  bcc?: string[];
} {
  const out: { to: string[]; cc?: string[]; bcc?: string[] } = {
    to: normalizeRecipients(message.to) ?? [],
  };
  const cc = normalizeRecipients(message.cc);
  if (cc && cc.length > 0) out.cc = cc;
  const bcc = normalizeRecipients(message.bcc);
  if (bcc && bcc.length > 0) out.bcc = bcc;
  return out;
}

/**
 * Lowercases the keys of a headers map. Keeps duplicate-key semantics to
 * whichever one the caller supplied last — same as the JS object itself.
 *
 * @internal
 */
export function _lowercaseHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

// ─── Memory adapter ─────────────────────────────────────────────────────────

/**
 * Creates an in-process email sender. Messages never leave the current
 * process — perfect for unit tests and dev environments.
 */
export function createMemoryEmailSender(): MemoryEmailSender {
  const spool: Array<EmailMessage & { id: string; sentAt: number }> = [];

  async function send(message: EmailMessage): Promise<EmailSendResult> {
    _validateMessage(message);
    const id = newId();
    const sentAt = Date.now();
    // Freeze a shallow snapshot so the spool entry doesn't mutate if the
    // caller reuses the `message` object.
    spool.push({
      ...message,
      id,
      sentAt,
    });
    return { id, sentAt };
  }

  function clear(): void {
    spool.length = 0;
  }

  async function waitFor(n: number = 1, timeoutMs: number = 1000): Promise<void> {
    if (n <= 0 || spool.length >= n) return;
    const deadline = Date.now() + timeoutMs;
    // Poll on a 10ms cadence — simpler than wiring a notifier and plenty
    // responsive for test assertions.
    while (spool.length < n) {
      if (Date.now() >= deadline) {
        throw new Error(
          `[@mandujs/core/email] waitFor timed out after ${timeoutMs}ms (got ${spool.length}/${n} messages).`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  return {
    send,
    clear,
    waitFor,
    // Expose the array itself as a readonly view. `ReadonlyArray` is purely
    // a TS-level guarantee; consumers that mutate via `as unknown as` are
    // reaching past the type system and get what they deserve.
    get sent() {
      return spool as ReadonlyArray<EmailMessage & { id: string; sentAt: number }>;
    },
  };
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export { createResendSender, type ResendOptions } from "./resend.js";
export { createSmtpSender, type SmtpOptions } from "./smtp.js";
