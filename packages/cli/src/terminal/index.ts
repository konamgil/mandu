/**
 * Terminal UI module
 *
 * DNA-009: Color palette & theme
 * DNA-013: Safe Stream Writer
 * DNA-017: Hero banner
 */

export { MANDU_PALETTE, type ManduColor } from "./palette.js";
export { theme, isRich, colorize, stripAnsi } from "./theme.js";
export {
  shouldShowBanner,
  renderHeroBanner,
  renderMiniBanner,
  renderBoxBanner,
} from "./banner.js";
export {
  createSafeStreamWriter,
  getSafeWriter,
  safePrint,
  safePrintln,
  safePrintError,
  type SafeStreamWriter,
  type SafeStreamWriterOptions,
} from "./stream-writer.js";
