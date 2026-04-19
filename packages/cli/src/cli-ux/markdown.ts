/**
 * Markdown → ANSI renderer for Mandu CLI UX (Phase 9a)
 *
 * Thin wrapper around `Bun.markdown.ansi` that honors NO_COLOR / TTY /
 * CI / `opts.plain` via the shared `isRich()` detector and degrades
 * gracefully to a plain-text fallback when either the runtime API is
 * unavailable or rich output is not supported by the current terminal.
 *
 * Phase 11.B — L-04: control-char / OSC 8 sanitizer.
 *   `Bun.markdown.ansi` passes raw ANSI escape codes (0x1B) through from
 *   source and emits OSC 8 hyperlinks with ANY URL scheme (including
 *   `javascript:`, `data:`). In automation pipelines where the source
 *   string includes attacker-influenced content (project names, error
 *   messages, user-supplied metadata), that passthrough lets the
 *   attacker clear the CI log, forge success messages, or plant
 *   clickable malicious links. We defend in two places:
 *
 *     1. Pre-render input sanitization — strip C0/C1/DEL control bytes
 *        except TAB (0x09) and LF (0x0A) before handing to the markdown
 *        engine. This blocks ESC (0x1B) injection via the source string.
 *
 *     2. Post-render OSC 8 URL allowlist — re-parse the ANSI output and
 *        drop any `\x1b]8;;<url>\x1b\\` whose scheme is not on
 *        `{http, https, file}`. URLs with disallowed schemes are
 *        replaced with a neutral `\x1b]8;;\x1b\\` (OSC 8 end-hyperlink)
 *        so the surrounding ANSI styling remains balanced.
 *
 *   See `docs/security/phase-9-audit.md` §L-04.
 *
 * @see docs/bun/phase-9-diagnostics/markdown-cli-ux.md
 */
import { isRich } from "../terminal/theme.js";

export interface RenderOptions {
  /**
   * Force plain text output regardless of terminal capabilities.
   * Default: auto (determined by `isRich()`).
   */
  plain?: boolean;
  /**
   * Maximum column width to use when wrapping rendered output.
   * Default: `process.stdout.columns` or `80`.
   */
  columns?: number;
  /**
   * Enable OSC 8 clickable hyperlinks (modern terminals).
   * Default: follows the rich-output decision.
   */
  hyperlinks?: boolean;
  /**
   * Opt in to `file://` scheme in OSC 8 hyperlinks. Wave R3 M-03 tightened
   * the default allow-list to `http`/`https` only because the same renderer
   * is used for AI chat output where attacker-influenced markdown could
   * smuggle `file:///etc/passwd` links. Callers that legitimately display
   * local documentation links (e.g. `mandu docs`) must opt in explicitly.
   * Default: `false`.
   */
  allowFileScheme?: boolean;
}

/**
 * Minimal structural shape we rely on from `Bun.markdown.ansi`.
 * We intentionally avoid the full Bun-types declaration so that the CLI
 * keeps compiling on toolchains where those types lag the runtime.
 */
interface MarkdownAnsiTheme {
  colors?: boolean;
  columns?: number;
  hyperlinks?: boolean;
}

interface BunMarkdownLike {
  ansi(input: string, theme?: MarkdownAnsiTheme): string;
}

function getBunMarkdown(): BunMarkdownLike | null {
  // Accessing via `globalThis` avoids a static dependency on Bun types.
  const bun = (globalThis as { Bun?: { markdown?: unknown } }).Bun;
  const md = bun?.markdown as { ansi?: unknown } | undefined;
  if (!md || typeof md.ansi !== "function") return null;
  return md as BunMarkdownLike;
}

/**
 * Strip dangerous C0/C1/DEL control bytes from a source string while
 * preserving TAB (0x09) and LF (0x0A) — the only control chars that
 * Markdown itself uses.
 *
 * Ranges stripped:
 *   - 0x00..0x08   (C0 control, excludes TAB)
 *   - 0x0B..0x1F   (C0 control, excludes LF; includes ESC = 0x1B)
 *   - 0x7F         (DEL)
 *   - 0x80..0x9F   (C1 control — some terminals interpret these as
 *                   escape shortcuts when written as UTF-8 two-byte seq)
 *
 * Exported for test coverage.
 *
 * @internal
 */
export function sanitizeControl(source: string): string {
  if (typeof source !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return source.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u0080-\u009F]/g, "");
}

/**
 * Allowed OSC 8 hyperlink URL schemes. We permit:
 *   - http / https  — standard web links
 *   - file          — local documentation (covers `file:///path/to/docs.md`)
 *
 * Explicitly rejected:
 *   - javascript    — same-origin script execution when terminal hands
 *                     URL back to a browser
 *   - data          — arbitrary payload smuggling
 *   - vbscript      — legacy IE-style attack vector
 *   - any other scheme (ftp, ssh, mailto, etc.) — conservative default
 *
 * @internal
 */
const OSC8_ALLOWED_SCHEMES = new Set(["http", "https"]);
/**
 * Wave R3 M-03 — `file://` is opt-in. Previously we auto-allowed it for
 * local-documentation links, but the same renderer also outputs AI chat
 * responses where attacker-influenced markdown could smuggle a clickable
 * `file:///etc/passwd` link. Callers that legitimately render local docs
 * must pass `{ allowFileScheme: true }` explicitly.
 */
const OSC8_FILE_SCHEME = "file";

/**
 * Re-scan a rendered ANSI string and neutralize OSC 8 hyperlinks whose
 * URL scheme is not on the allowlist. We replace the URL portion with
 * empty (i.e. convert `\x1b]8;;javascript:alert(1)\x1b\\` to
 * `\x1b]8;;\x1b\\`) so the link label remains visible but the clickable
 * behavior is dropped. ANSI color balancing is preserved because the
 * trailing `\x1b]8;;\x1b\\` end-of-hyperlink marker still matches.
 *
 * OSC 8 structure (per xterm spec):
 *   `\x1b]8;<params>;<url>\x1b\\` ... label ... `\x1b]8;;\x1b\\`
 *
 * The `\x1b\\` terminator is ST (String Terminator). Some terminals
 * accept BEL (0x07) instead — we handle both.
 *
 * Exported for test coverage.
 *
 * @internal
 */
export function sanitizeOsc8(
  rendered: string,
  opts: { allowFileScheme?: boolean } = {},
): string {
  if (typeof rendered !== "string" || rendered.length === 0) return rendered;
  // Fast path: no OSC 8 introducer at all.
  if (!rendered.includes("\x1b]8;")) return rendered;

  // Match the opening OSC 8: `\x1b]8;<params>;<url>(\x1b\\|\x07)`. Params
  // are typically empty but may contain key=value pairs (never a `;` —
  // that terminates the params section). The URL runs until ST or BEL.
  // eslint-disable-next-line no-control-regex
  const OSC8_OPEN = /\x1b\]8;([^;\x07\x1b]*);([^\x07\x1b]*)(\x1b\\|\x07)/g;

  return rendered.replace(OSC8_OPEN, (_match, params: string, url: string, terminator: string) => {
    if (!url) {
      // Empty URL is the closing marker — pass through unchanged.
      return `\x1b]8;${params};${terminator}`;
    }
    // Extract scheme — the part before the first colon. Reject if
    // absent (relative URL inside a terminal is meaningless) or not on
    // allowlist. Case-insensitive per RFC 3986 §3.1.
    const colonIdx = url.indexOf(":");
    if (colonIdx < 1) {
      return `\x1b]8;${params};${terminator}`;
    }
    const scheme = url.slice(0, colonIdx).toLowerCase();
    const accepted =
      OSC8_ALLOWED_SCHEMES.has(scheme) ||
      (opts.allowFileScheme === true && scheme === OSC8_FILE_SCHEME);
    if (!accepted) {
      // Drop the URL — keep the label (which is emitted after this
      // match) and the closing OSC 8 that appears later. We emit an
      // end-of-hyperlink sequence here so the terminal resets its
      // active-link state before the label is printed.
      return `\x1b]8;;${terminator}`;
    }
    // URL passed allowlist — preserve verbatim.
    return `\x1b]8;${params};${url}${terminator}`;
  });
}

/**
 * Render Markdown input to ANSI-colored terminal output.
 *
 * - Honors `NO_COLOR`, `FORCE_COLOR`, non-TTY, `TERM=dumb` via `isRich()`.
 * - Falls back to plain text when `Bun.markdown` is unavailable (e.g.
 *   non-Bun runtime, older Bun, or an unexpected runtime error).
 * - Returns the input untouched when both the markdown engine and the
 *   plain fallback would agree (pure prose).
 *
 * Phase 11.B: input is sanitized (C0/C1/DEL stripped) before render and
 * OSC 8 output is re-scanned against a scheme allowlist. See module
 * docstring for threat model.
 */
export function renderMarkdown(source: string, opts: RenderOptions = {}): string {
  if (typeof source !== "string") return "";
  const clean = sanitizeControl(source);
  const rich = !opts.plain && isRich();
  if (!rich) {
    return plainFallback(clean);
  }
  const md = getBunMarkdown();
  if (!md) return plainFallback(clean);
  try {
    const columns = resolveColumns(opts.columns);
    const hyperlinks = opts.hyperlinks ?? true;
    const raw = md.ansi(clean, {
      colors: true,
      columns,
      hyperlinks,
    });
    return sanitizeOsc8(raw, { allowFileScheme: opts.allowFileScheme });
  } catch {
    return plainFallback(clean);
  }
}

/**
 * Remove common Markdown markup so the result is still readable as plain
 * text in CI logs, file captures, or color-blocked environments.
 *
 * We keep the fallback deliberately small — just enough to avoid noise
 * from fences, inline code, bold, and link syntax. Headings and lists
 * are left untouched because the surrounding `#`, `-`, or `1.` still
 * reads naturally in plain output.
 */
export function plainFallback(source: string): string {
  if (!source) return "";
  return source
    // fenced code blocks: ```lang\n...\n``` → inner body
    .replace(/```[\w-]*\r?\n([\s\S]*?)```/g, "$1")
    // inline code: `foo` → foo
    .replace(/`([^`\n]+)`/g, "$1")
    // bold: **foo** → foo
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    // link: [label](url) → label
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1");
}

function resolveColumns(explicit?: number): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const cols = process.stdout.columns;
  if (typeof cols === "number" && cols > 0) return cols;
  return 80;
}
