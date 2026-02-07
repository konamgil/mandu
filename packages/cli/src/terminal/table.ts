/**
 * DNA-011: ANSI-aware Table Rendering
 *
 * 터미널 테이블 렌더링
 * - ANSI 색상 코드 인식 (너비 계산에서 제외)
 * - 유니코드 박스 문자 지원
 * - 반응형 너비 조정 (flex 컬럼)
 */

import { stripAnsi } from "./theme.js";

/**
 * 테이블 컬럼 정의
 */
export interface TableColumn {
  /** 데이터 키 */
  key: string;
  /** 헤더 텍스트 */
  header: string;
  /** 정렬 (기본: left) */
  align?: "left" | "right" | "center";
  /** 최소 너비 */
  minWidth?: number;
  /** 최대 너비 */
  maxWidth?: number;
  /** 반응형 너비 조정 대상 */
  flex?: boolean;
}

/**
 * 테두리 스타일
 */
export type BorderStyle = "unicode" | "ascii" | "none";

/**
 * 테이블 렌더링 옵션
 */
export interface RenderTableOptions {
  /** 컬럼 정의 */
  columns: TableColumn[];
  /** 데이터 행 */
  rows: Record<string, unknown>[];
  /** 테두리 스타일 (기본: unicode) */
  border?: BorderStyle;
  /** 최대 테이블 너비 */
  maxWidth?: number;
  /** 헤더 표시 여부 (기본: true) */
  showHeader?: boolean;
  /** 컴팩트 모드 (패딩 최소화) */
  compact?: boolean;
}

/**
 * 박스 그리기 문자
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
 * ANSI 코드를 제외한 실제 표시 너비 계산
 */
function displayWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * 문자열 패딩 (ANSI 인식)
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
 * 문자열 트렁케이션 (ANSI 인식)
 */
function truncateWithAnsi(str: string, maxWidth: number): string {
  const plain = stripAnsi(str);
  if (plain.length <= maxWidth) return str;

  // ANSI 코드 위치 추적
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  const ansiCodes: { index: number; code: string }[] = [];
  let match;
  while ((match = ansiRegex.exec(str)) !== null) {
    ansiCodes.push({ index: match.index, code: match[0] });
  }

  // plain text 기준으로 트렁케이션
  const truncatedPlain = plain.slice(0, maxWidth - 1) + "…";

  // ANSI 코드가 없으면 그대로 반환
  if (ansiCodes.length === 0) return truncatedPlain;

  // ANSI 코드 재삽입 (복잡하므로 단순화)
  // 첫 번째와 마지막 ANSI 코드만 보존
  const firstCode = ansiCodes[0]?.code || "";
  const resetCode = "\x1b[0m";

  if (firstCode && ansiCodes.length > 0) {
    return firstCode + truncatedPlain + resetCode;
  }

  return truncatedPlain;
}

/**
 * 컬럼 너비 계산
 */
function calculateWidths(
  columns: TableColumn[],
  rows: Record<string, unknown>[],
  maxWidth?: number,
  compact?: boolean,
  border: BorderStyle = "unicode"
): number[] {
  const padding = compact ? 1 : 2;

  // 각 컬럼의 초기 너비 계산
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

  // 최대 너비 제약 처리
  if (maxWidth) {
    const borderWidth = border === "none" ? 0 : columns.length + 1; // 세로선 개수
    const totalWidth = widths.reduce((a, b) => a + b, 0) + borderWidth;

    if (totalWidth > maxWidth) {
      const overflow = totalWidth - maxWidth;
      const flexIndices = columns
        .map((c, i) => (c.flex ? i : -1))
        .filter((i) => i >= 0);

      if (flexIndices.length > 0) {
        // flex 컬럼에서 균등 축소
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
 * 테이블 렌더링
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

  // 수평선 생성
  const createLine = (
    left: string,
    mid: string,
    right: string,
    fill: string
  ): string => {
    const segments = widths.map((w) => fill.repeat(w));
    return left + segments.join(mid) + right;
  };

  // 데이터 행 생성
  const createRow = (data: Record<string, unknown>): string => {
    const cells = columns.map((col, i) => {
      let value = String(data[col.key] ?? "");
      const width = widths[i];

      // 트렁케이션
      if (displayWidth(value) > width - (compact ? 1 : 2)) {
        value = truncateWithAnsi(value, width - (compact ? 1 : 2));
      }

      // 패딩
      const padded = padString(value, width - (compact ? 0 : 1), col.align);
      return compact ? padded : " " + padded;
    });

    if (border === "none") {
      return cells.join(" ");
    }
    return box.v + cells.join(box.v) + box.v;
  };

  // 상단 테두리
  if (border !== "none") {
    lines.push(createLine(box.tl, box.t, box.tr, box.h));
  }

  // 헤더
  if (showHeader) {
    const headerRow: Record<string, unknown> = {};
    for (const col of columns) {
      headerRow[col.key] = col.header;
    }
    lines.push(createRow(headerRow));

    // 헤더 구분선
    if (border !== "none") {
      lines.push(createLine(box.ml, box.m, box.mr, box.h));
    }
  }

  // 데이터 행
  for (const row of rows) {
    lines.push(createRow(row));
  }

  // 하단 테두리
  if (border !== "none") {
    lines.push(createLine(box.bl, box.b, box.br, box.h));
  }

  return lines.join("\n");
}

/**
 * 간단한 리스트 테이블 (키-값 쌍)
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
