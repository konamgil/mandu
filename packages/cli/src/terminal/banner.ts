/**
 * DNA-017: Hero Banner with cfonts + gradient
 *
 * Sexy ASCII art banner for CLI startup
 * Inspired by Claude Code, Vite, Astro CLI screens
 *
 * @see https://github.com/dominikwilkowski/cfonts
 */

import { theme, isRich, stripAnsi } from "./theme.js";
import { MANDU_PALETTE } from "./palette.js";

/**
 * Check if banner should be displayed
 */
export function shouldShowBanner(argv: string[]): boolean {
  // Environment-based skip
  if (process.env.MANDU_NO_BANNER) return false;
  if (process.env.CI) return false;
  if (process.env.CLAUDE_CODE) return false;
  if (process.env.CODEX_AGENT) return false;
  if (process.env.MANDU_AGENT) return false;

  // TTY check
  if (!process.stdout.isTTY) return false;

  // Flag-based skip
  const hasJsonFlag = argv.includes("--json");
  const hasQuietFlag = argv.includes("--quiet") || argv.includes("-q");
  const hasHelpFlag = argv.includes("--help") || argv.includes("-h");

  if (hasJsonFlag || hasQuietFlag || hasHelpFlag) return false;

  return true;
}

/**
 * Fallback ASCII art banner (no dependencies)
 */
const MANDU_ASCII_SMALL = `
  ╔╦╗╔═╗╔╗╔╔╦╗╦ ╦
  ║║║╠═╣║║║ ║║║ ║
  ╩ ╩╩ ╩╝╚╝═╩╝╚═╝
`;

const MANDU_ASCII_LARGE = `
  ███╗   ███╗ █████╗ ███╗   ██╗██████╗ ██╗   ██╗
  ████╗ ████║██╔══██╗████╗  ██║██╔══██╗██║   ██║
  ██╔████╔██║███████║██╔██╗ ██║██║  ██║██║   ██║
  ██║╚██╔╝██║██╔══██║██║╚██╗██║██║  ██║██║   ██║
  ██║ ╚═╝ ██║██║  ██║██║ ╚████║██████╔╝╚██████╔╝
  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝
`;

/**
 * Apply gradient effect to text (simple version)
 */
function applyGradient(text: string): string {
  if (!isRich()) return text;

  const lines = text.split("\n");
  const colorFns = [
    theme.accentDim,
    theme.accent,
    theme.accentBright,
    theme.accent,
    theme.accentDim,
  ];

  return lines
    .map((line, i) => {
      const colorIndex = Math.min(i, colorFns.length - 1);
      const colorFn = colorFns[colorIndex];
      return colorFn(line);
    })
    .join("\n");
}

/**
 * Render hero banner with cfonts (if available) or fallback
 */
export async function renderHeroBanner(version: string): Promise<void> {
  const cols = process.stdout.columns ?? 80;

  // Very narrow terminal: minimal output
  if (cols < 40) {
    console.log(`\n  🥟 Mandu v${version}\n`);
    return;
  }

  // Try cfonts first
  try {
    const cfonts = await import("cfonts");

    cfonts.say("MANDU", {
      font: "block",
      gradient: [MANDU_PALETTE.accent, MANDU_PALETTE.accentBright],
      transitionGradient: true,
      align: "center",
      space: true,
      maxLength: Math.min(cols - 4, 80),
    });
  } catch {
    // cfonts not available, use fallback
    const ascii = cols >= 60 ? MANDU_ASCII_LARGE : MANDU_ASCII_SMALL;
    console.log(applyGradient(ascii));
  }

  // Tagline
  const tagline = `🥟 Agent-Native Web Framework v${version}`;
  const taglineWidth = stripAnsi(tagline).length;
  const padding = Math.max(0, Math.floor((cols - taglineWidth) / 2));

  console.log(" ".repeat(padding) + theme.muted(tagline));
  console.log();
}

/**
 * Render minimal banner (for narrow terminals or quick commands)
 */
export function renderMiniBanner(version: string): void {
  if (!isRich()) {
    console.log(`\nMandu v${version}\n`);
    return;
  }

  console.log();
  console.log(`  ${theme.heading("🥟 Mandu")} ${theme.muted(`v${version}`)}`);
  console.log(`  ${theme.muted("Agent-Native Web Framework")}`);
  console.log();
}

/**
 * Render box banner (alternative style)
 */
export function renderBoxBanner(version: string): void {
  if (!isRich()) {
    console.log(`\nMandu v${version}\n`);
    return;
  }

  const width = 30;
  const top = theme.accent("  ╭" + "─".repeat(width) + "╮");
  const mid1 =
    theme.accent("  │") +
    "  " +
    theme.heading("🥟 Mandu") +
    " " +
    theme.muted(`v${version}`) +
    " ".repeat(width - 18 - version.length) +
    theme.accent("│");
  const mid2 =
    theme.accent("  │") +
    "  " +
    theme.muted("Agent-Native Framework") +
    " ".repeat(width - 24) +
    theme.accent("│");
  const bottom = theme.accent("  ╰" + "─".repeat(width) + "╯");

  console.log();
  console.log(top);
  console.log(mid1);
  console.log(mid2);
  console.log(bottom);
  console.log();
}
