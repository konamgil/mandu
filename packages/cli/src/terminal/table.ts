/**
 * DNA-011: ANSI-aware Table Rendering
 *
 * Terminal table rendering
 * - ANSI color code aware (excluded from width calculation)
 * - Unicode box character support
 * - Responsive width adjustment (flex columns)
 */

import { stripAnsi } from "./theme.js";

/**
 * Table column definition
 */
export interface TableColumn {
  /** Data key */
  key: string;
  /** Header text */
  header: string;
  /** Alignment (default: left) */
  align?: "left" | "right" | "center";
  /** Minimum width */
  minWidth?: number;
  /** Maximum width */
  maxWidth?: number;
  /** Responsive width adjustment target */
  flex?: boolean;
}

/**
 * Border style
 */
export type BorderStyle = "unicode" | "ascii" | "none";

/**
 * Table rendering options
 */
export interface RenderTableOptions {
  /** Column definitions */
  columns: TableColumn[];
  /** Data rows */
  rows: Record<string, unknown>[];
  /** Border style (default: unicode) */
  border?: BorderStyle;
  /** Maximum table width */
  maxWidth?: number;
  /** Whether to show header (default: true) */
  showHeader?: boolean;
  /** Compact mode (minimize padding) */
  compact?: boolean;
}

/**
 * Box drawing characters
 */
interface BoxChars {
  tl: string; // top-left
  tr: string; // top-right
  bl: string; // bottom-left
  br: string; // bottom-right
  h: string;  // horizontal
  v: string;  // vertical
  t: string;  // top junction
  b: string;  // bottom junction
  ml: string; // middle-left
  mr: string; // middle-right
  m: string;  // middle junction
}

const UNICODE_BOX: BoxChars = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  t: "┬",
  b: "┴",
  ml: "├",
  mr: "┤",
  m: "┼",
};

const ASCII_BOX: BoxChars = {
  tl: "+",
  tr: "+",
  bl: "+",
  br: "+",
  h: "-",
  v: "|",
  t: "+",
  b: "+",
  ml: "+",
  mr: "+",
  m: "+",
};

/**
 * Calculate actual display width excluding ANSI codes
 */
function displayWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * String padding (ANSI-aware)
 */
function padString(
  str: string,
  width: number,
  align: "left" | "right" | "center" = "left"
): string {
  const visibleLen = displayWidth(str);
  const padding = width - visibleLen;

  if (padding <= 0) return str;

  switch (align) {
    case "right":
      return " ".repeat(padding) + str;
    case "center": {
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return " ".repeat(left) + str + " ".repeat(right);
    }
    case "left":
    default:
      return str + " ".repeat(padding);
  }
}

/**
 * String truncation (ANSI-aware)
 */
function truncateWithAnsi(str: string, maxWidth: number): string {
  const plain = stripAnsi(str);
  if (plain.length <= maxWidth) return str;

  // Track ANSI code positions
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  const ansiCodes: { index: number; code: string }[] = [];
  let match;
  while ((match = ansiRegex.exec(str)) !== null) {
    ansiCodes.push({ index: match.index, code: match[0] });
  }

  // Truncate based on plain text
  const truncatedPlain = plain.slice(0, maxWidth - 1) + "…";

  // Return as-is if no ANSI codes
  if (ansiCodes.length === 0) return truncatedPlain;

  // Re-insert ANSI codes (simplified)
  // Preserve only first and last ANSI codes
  const firstCode = ansiCodes[0]?.code || "";
  const resetCode = "\x1b[0m";

  if (firstCode && ansiCodes.length > 0) {
    return firstCode + truncatedPlain + resetCode;
  }

  return truncatedPlain;
}

/**
 * Calculate column widths
 */
function calculateWidths(
  columns: TableColumn[],
  rows: Record<string, unknown>[],
  maxWidth?: number,
  compact?: boolean,
  border: BorderStyle = "unicode"
): number[] {
  const padding = compact ? 1 : 2;

  // Calculate initial width for each column
  const widths = columns.map((col) => {
    const headerWidth = displayWidth(col.header);
    const maxCellWidth = Math.max(
      0,
      ...rows.map((row) => displayWidth(String(row[col.key] ?? "")))
    );
    const contentWidth = Math.max(headerWidth, maxCellWidth);

    let width = contentWidth + padding;

    if (col.minWidth) width = Math.max(width, col.minWidth);
    if (col.maxWidth) width = Math.min(width, col.maxWidth);

    return width;
  });

  // Handle max width constraint
  if (maxWidth) {
    const borderWidth = border === "none" ? 0 : columns.length + 1; // number of vertical lines
    const totalWidth = widths.reduce((a, b) => a + b, 0) + borderWidth;

    if (totalWidth > maxWidth) {
      const overflow = totalWidth - maxWidth;
      const flexIndices = columns
        .map((c, i) => (c.flex ? i : -1))
        .filter((i) => i >= 0);

      if (flexIndices.length > 0) {
        // Shrink evenly across flex columns
        const shrinkPerColumn = Math.ceil(overflow / flexIndices.length);
        for (const idx of flexIndices) {
          const minW = columns[idx].minWidth ?? 5;
          widths[idx] = Math.max(minW, widths[idx] - shrinkPerColumn);
        }
      }
    }
  }

  return widths;
}

/**
 * Render table
 *
 * @example
 * ```ts
 * const output = renderTable({
 *   columns: [
 *     { key: "name", header: "Name", minWidth: 10 },
 *     { key: "status", header: "Status", align: "center" },
 *     { key: "size", header: "Size", align: "right" },
 *   ],
 *   rows: [
 *     { name: "file1.ts", status: "✓", size: "1.2KB" },
 *     { name: "file2.ts", status: "✗", size: "3.4KB" },
 *   ],
 *   border: "unicode",
 * });
 *
 * // ┌────────────┬────────┬───────┐
 * // │ Name       │ Status │  Size │
 * // ├────────────┼────────┼───────┤
 * // │ file1.ts   │   ✓    │ 1.2KB │
 * // │ file2.ts   │   ✗    │ 3.4KB │
 * // └────────────┴────────┴───────┘
 * ```
 */
export function renderTable(options: RenderTableOptions): string {
  const {
    columns,
    rows,
    border = "unicode",
    maxWidth,
    showHeader = true,
    compact = false,
  } = options;

  if (columns.length === 0) return "";

  const widths = calculateWidths(columns, rows, maxWidth, compact, border);
  const box = border === "unicode" ? UNICODE_BOX : ASCII_BOX;
  const lines: string[] = [];

  // Create horizontal line
  const createLine = (
    left: string,
    mid: string,
    right: string,
    fill: string
  ): string => {
    const segments = widths.map((w) => fill.repeat(w));
    return left + segments.join(mid) + right;
  };

  // Create data row
  const createRow = (data: Record<string, unknown>): string => {
    const cells = columns.map((col, i) => {
      let value = String(data[col.key] ?? "");
      const width = widths[i];

      // Truncation
      if (displayWidth(value) > width - (compact ? 1 : 2)) {
        value = truncateWithAnsi(value, width - (compact ? 1 : 2));
      }

      // Padding
      const padded = padString(value, width - (compact ? 0 : 1), col.align);
      return compact ? padded : " " + padded;
    });

    if (border === "none") {
      return cells.join(" ");
    }
    return box.v + cells.join(box.v) + box.v;
  };

  // Top border
  if (border !== "none") {
    lines.push(createLine(box.tl, box.t, box.tr, box.h));
  }

  // Header
  if (showHeader) {
    const headerRow: Record<string, unknown> = {};
    for (const col of columns) {
      headerRow[col.key] = col.header;
    }
    lines.push(createRow(headerRow));

    // Header separator
    if (border !== "none") {
      lines.push(createLine(box.ml, box.m, box.mr, box.h));
    }
  }

  // Data rows
  for (const row of rows) {
    lines.push(createRow(row));
  }

  // Bottom border
  if (border !== "none") {
    lines.push(createLine(box.bl, box.b, box.br, box.h));
  }

  return lines.join("\n");
}

/**
 * Simple list table (key-value pairs)
 *
 * @example
 * ```ts
 * renderKeyValueTable([
 *   { key: "Name", value: "Mandu" },
 *   { key: "Version", value: "0.11.0" },
 * ]);
 * // ┌─────────┬─────────┐
 * // │ Name    │ Mandu   │
 * // │ Version │ 0.11.0  │
 * // └─────────┴─────────┘
 * ```
 */
export function renderKeyValueTable(
  items: { key: string; value: string }[],
  options: { border?: BorderStyle; maxWidth?: number } = {}
): string {
  return renderTable({
    columns: [
      { key: "key", header: "Key" },
      { key: "value", header: "Value", flex: true },
    ],
    rows: items,
    showHeader: false,
    ...options,
  });
}
