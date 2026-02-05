/**
 * Terminal UI module
 *
 * DNA-009: Color palette & theme
 * DNA-013: Safe Stream Writer
 * DNA-015: Semantic help system
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
export {
  getOutputMode,
  createFormatContext,
  formatOutput,
  formatError,
  formatSuccess,
  formatWarning,
  formatInfo,
  formatList,
  type OutputMode,
  type OutputOptions,
  type FormatContext,
} from "./output.js";
export {
  renderTable,
  renderKeyValueTable,
  type TableColumn,
  type BorderStyle,
  type RenderTableOptions,
} from "./table.js";
export {
  createCliProgress,
  withProgress,
  startSpinner,
  runSteps,
  type ProgressOptions,
  type ProgressReporter,
} from "./progress.js";
export {
  formatHelpExample,
  formatHelpExampleGroup,
  formatHelpOption,
  formatHelpSubcommand,
  formatSectionTitle,
  renderHelp,
  renderCommandHelp,
  formatUsageHint,
  formatErrorHint,
  MANDU_HELP,
  type HelpExample,
  type HelpOption,
  type HelpSubcommand,
  type HelpSection,
  type HelpDefinition,
} from "./help.js";
