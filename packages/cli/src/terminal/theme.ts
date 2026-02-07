/**
 * DNA-009: Mandu CLI Theme System
 *
 * Chalk-based dynamic color theme with NO_COLOR/FORCE_COLOR support
 * Inspired by OpenClaw's terminal/theme.ts
 */

import { MANDU_PALETTE } from "./palette.js";

// Bun's native console supports colors, but we need a simple wrapper
// for consistent theming across the CLI

/**
 * Check if rich output (colors) is supported
 */
function checkRichSupport(): boolean {
  // NO_COLOR takes precedence (accessibility standard)
  if (process.env.NO_COLOR) {
    const forceColor = process.env.FORCE_COLOR?.trim();
    if (forceColor !== "1" && forceColor !== "true") {
      return false;
    }
  }

  // Check TTY
  if (!process.stdout.isTTY) {
    return false;
  }

  // Check TERM
  const term = process.env.TERM;
  if (term === "dumb") {
    return false;
  }

  return true;
}

const richSupported = checkRichSupport();

/**
 * ANSI escape code wrapper
 */
function ansi(code: string) {
  return richSupported ? `\x1b[${code}m` : "";
}

/**
 * Convert hex to ANSI 256 color (approximation)
 */
function hexToAnsi256(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Convert to 6x6x6 color cube
  const ri = Math.round((r / 255) * 5);
  const gi = Math.round((g / 255) * 5);
  const bi = Math.round((b / 255) * 5);

  return 16 + 36 * ri + 6 * gi + bi;
}

/**
 * Create a color function from hex
 */
function hex(hexColor: string): (text: string) => string {
  if (!richSupported) return (text) => text;

  const colorCode = hexToAnsi256(hexColor);
  return (text) => `\x1b[38;5;${colorCode}m${text}\x1b[0m`;
}

/**
 * Create a bold color function
 */
function boldHex(hexColor: string): (text: string) => string {
  if (!richSupported) return (text) => text;

  const colorCode = hexToAnsi256(hexColor);
  return (text) => `\x1b[1;38;5;${colorCode}m${text}\x1b[0m`;
}

/**
 * Mandu CLI Theme
 */
export const theme = {
  // Brand colors
  accent: hex(MANDU_PALETTE.accent),
  accentBright: hex(MANDU_PALETTE.accentBright),
  accentDim: hex(MANDU_PALETTE.accentDim),

  // Semantic colors
  info: hex(MANDU_PALETTE.info),
  success: hex(MANDU_PALETTE.success),
  warn: hex(MANDU_PALETTE.warn),
  error: hex(MANDU_PALETTE.error),

  // Neutral
  muted: hex(MANDU_PALETTE.muted),
  dim: hex(MANDU_PALETTE.dim),

  // Composite styles
  heading: boldHex(MANDU_PALETTE.accent),
  command: hex(MANDU_PALETTE.accentBright),
  option: hex(MANDU_PALETTE.warn),
  path: hex(MANDU_PALETTE.info),

  // Basic styles
  bold: richSupported ? (text: string) => `\x1b[1m${text}\x1b[0m` : (text: string) => text,
  italic: richSupported ? (text: string) => `\x1b[3m${text}\x1b[0m` : (text: string) => text,
  underline: richSupported ? (text: string) => `\x1b[4m${text}\x1b[0m` : (text: string) => text,

  // Reset
  reset: richSupported ? "\x1b[0m" : "",
} as const;

/**
 * Check if rich output is available
 */
export function isRich(): boolean {
  return richSupported;
}

/**
 * Conditionally apply color based on rich mode
 */
export function colorize(
  rich: boolean,
  colorFn: (text: string) => string,
  text: string
): string {
  return rich ? colorFn(text) : text;
}

/**
 * Strip ANSI codes from string (for width calculation)
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
