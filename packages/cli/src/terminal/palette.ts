/**
 * DNA-009: Mandu Color Palette
 *
 * Inspired by OpenClaw's "Lobster Seam" palette
 * @see https://github.com/dominikwilkowski/cfonts
 */

/**
 * Mandu brand color palette
 * Warm tone based on pink
 */
export const MANDU_PALETTE = {
  // Brand color (mandu pink)
  accent: "#E8B4B8",
  accentBright: "#F5D0D3",
  accentDim: "#C9A0A4",

  // Semantic colors
  info: "#87CEEB", // sky blue
  success: "#90EE90", // light green
  warn: "#FFD700", // gold
  error: "#FF6B6B", // coral red

  // Neutrals
  muted: "#9CA3AF", // gray
  dim: "#6B7280", // dark gray
  text: "#F9FAFB", // white
} as const;

export type ManduColor = keyof typeof MANDU_PALETTE;
