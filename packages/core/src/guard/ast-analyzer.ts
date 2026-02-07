/**
 * Mandu Guard AST Analyzer
 *
 * TypeScript AST 기반 정밀 분석
 *
 * 정규식보다 정확한 import 추출
 * - 주석 내 import 무시
 * - 문자열 내 import 무시
 * - 복잡한 멀티라인 import 처리
 * - Type-only import 구분
 */

import type { ImportInfo } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Token Types
// ═══════════════════════════════════════════════════════════════════════════

type TokenType =
  | "import"
  | "export"
  | "from"
  | "require"
  | "string"
  | "identifier"
  | "punctuation"
  | "keyword"
  | "comment"
  | "whitespace"
  | "newline"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Lexer (Tokenizer)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 간단한 TypeScript/JavaScript 토크나이저
 */
function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  const keywords = new Set([
    "import",
    "export",
    "from",
    "as",
    "type",
    "typeof",
    "const",
    "let",
    "var",
    "function",
    "class",
    "interface",
    "enum",
    "await",
    "async",
    "default",
    "require",
  ]);

  while (pos < content.length) {
    const start = pos;
    const startLine = line;
    const startColumn = column;
    let char = content[pos];

    // Newline
    if (char === "\n") {
      pos++;
      line++;
      column = 1;
      tokens.push({
        type: "newline",
        value: "\n",
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // Whitespace
    if (/\s/.test(char)) {
      while (pos < content.length && /\s/.test(content[pos]) && content[pos] !== "\n") {
        pos++;
        column++;
      }
      tokens.push({
        type: "whitespace",
        value: content.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // Single-line comment
    if (char === "/" && content[pos + 1] === "/") {
      while (pos < content.length && content[pos] !== "\n") {
        pos++;
        column++;
      }
      tokens.push({
        type: "comment",
        value: content.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // Multi-line comment
    if (char === "/" && content[pos + 1] === "*") {
      pos += 2;
      column += 2;
      while (pos < content.length && !(content[pos] === "*" && content[pos + 1] === "/")) {
        if (content[pos] === "\n") {
          line++;
          column = 1;
        } else {
          column++;
        }
        pos++;
      }
      pos += 2;
      column += 2;
      tokens.push({
        type: "comment",
        value: content.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // String (single quote)
    if (char === "'") {
      pos++;
      column++;
      while (pos < content.length && content[pos] !== "'") {
        if (content[pos] === "\\") {
          pos++;
          column++;
        }
        if (content[pos] === "\n") {
          line++;
          column = 1;
        } else {
          column++;
        }
        pos++;
      }
      pos++; // closing quote
      column++;
      tokens.push({
        type: "string",
        value: content.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // String (double quote)
    if (char === '"') {
      pos++;
      column++;
      while (pos < content.length && content[pos] !== '"') {
        if (content[pos] === "\\") {
          pos++;
          column++;
        }
        if (content[pos] === "\n") {
          line++;
          column = 1;
        } else {
          column++;
        }
        pos++;
      }
      pos++; // closing quote
      column++;
      tokens.push({
        type: "string",
        value: content.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // Template literal (backtick) - simplified
    if (char === "`") {
      pos++;
      column++;
      while (pos < content.length && content[pos] !== "`") {
        if (content[pos] === "\\") {
          pos++;
          column++;
        }
        if (content[pos] === "\n") {
          line++;
          column = 1;
        } else {
          column++;
        }
        pos++;
      }
      pos++; // closing backtick
      column++;
      tokens.push({
        type: "string",
        value: content.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // Punctuation
    if (/[{}()\[\];,.*]/.test(char)) {
      pos++;
      column++;
      tokens.push({
        type: "punctuation",
        value: char,
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_$]/.test(char)) {
      while (pos < content.length && /[a-zA-Z0-9_$]/.test(content[pos])) {
        pos++;
        column++;
      }
      const value = content.slice(start, pos);
      const type: TokenType = keywords.has(value)
        ? value === "import"
          ? "import"
          : value === "from"
          ? "from"
          : value === "require"
          ? "require"
          : "keyword"
        : "identifier";

      tokens.push({
        type,
        value,
        start,
        end: pos,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    // Skip other characters
    pos++;
    column++;
  }

  tokens.push({
    type: "eof",
    value: "",
    start: pos,
    end: pos,
    line,
    column,
  });

  return tokens;
}

// ═══════════════════════════════════════════════════════════════════════════
// AST Import Extraction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AST 기반 import 추출
 *
 * 정규식보다 정확하게 import 문을 추출
 */
export function extractImportsAST(content: string): ImportInfo[] {
  const tokens = tokenize(content);
  const imports: ImportInfo[] = [];

  let i = 0;

  // Skip whitespace, newlines, comments
  const skip = () => {
    while (
      i < tokens.length &&
      (tokens[i].type === "whitespace" ||
        tokens[i].type === "newline" ||
        tokens[i].type === "comment")
    ) {
      i++;
    }
  };

  // Get current token
  const current = () => tokens[i];

  // Check if current token matches
  const is = (type: TokenType, value?: string) => {
    const t = current();
    return t && t.type === type && (value === undefined || t.value === value);
  };

  // Consume token if matches
  const consume = (type: TokenType, value?: string) => {
    if (is(type, value)) {
      const t = current();
      i++;
      return t;
    }
    return null;
  };

  while (i < tokens.length && current().type !== "eof") {
    skip();

    // Static import: import ... from '...'
    // Dynamic import: import('...')
    if (is("import")) {
      const importToken = consume("import")!;
      skip();

      // Dynamic import: import('...')
      if (is("punctuation", "(")) {
        consume("punctuation", "(");
        skip();
        if (is("string")) {
          const pathToken = consume("string")!;
          const path = pathToken.value.slice(1, -1);
          skip();
          consume("punctuation", ")");

          imports.push({
            statement: `import('${path}')`,
            path,
            line: importToken.line,
            column: importToken.column,
            type: "dynamic",
          });
        }
        continue;
      }

      let namedImports: string[] | undefined;
      let defaultImport: string | undefined;
      let namespaceImport: string | undefined;
      let isTypeOnly = false;

      // Check for type-only import
      if (is("keyword", "type")) {
        consume("keyword", "type");
        skip();
        isTypeOnly = true;
      }

      // Side-effect import: import '...'
      if (is("string")) {
        const pathToken = consume("string")!;
        const path = pathToken.value.slice(1, -1); // Remove quotes

        imports.push({
          statement: content.slice(importToken.start, pathToken.end),
          path,
          line: importToken.line,
          column: importToken.column,
          type: "static",
        });
        continue;
      }

      // Default import: import X from '...'
      if (is("identifier")) {
        defaultImport = consume("identifier")!.value;
        skip();

        // import X, { ... } from '...'
        if (is("punctuation", ",")) {
          consume("punctuation", ",");
          skip();
        }
      }

      // Namespace import: import * as X from '...'
      if (is("punctuation", "*")) {
        consume("punctuation", "*");
        skip();
        if (is("keyword", "as")) {
          consume("keyword", "as");
          skip();
          if (is("identifier")) {
            namespaceImport = consume("identifier")!.value;
            skip();
          }
        }
      }

      // Named imports: import { X, Y } from '...'
      if (is("punctuation", "{")) {
        consume("punctuation", "{");
        skip();
        namedImports = [];

        while (!is("punctuation", "}") && !is("eof")) {
          if (is("identifier") || is("keyword")) {
            const name = current().value;
            i++;
            skip();

            // Handle 'as' alias
            if (is("keyword", "as")) {
              consume("keyword", "as");
              skip();
              if (is("identifier")) {
                consume("identifier");
                skip();
              }
            }

            namedImports.push(name);
          }

          if (is("punctuation", ",")) {
            consume("punctuation", ",");
            skip();
          } else {
            break;
          }
        }

        consume("punctuation", "}");
        skip();
      }

      // from '...'
      if (is("from")) {
        consume("from");
        skip();

        if (is("string")) {
          const pathToken = consume("string")!;
          const path = pathToken.value.slice(1, -1);

          imports.push({
            statement: content.slice(importToken.start, pathToken.end),
            path,
            line: importToken.line,
            column: importToken.column,
            type: "static",
            namedImports: namedImports?.length ? namedImports : undefined,
            defaultImport,
          });
        }
      }

      continue;
    }

    // require('...')
    if (is("require")) {
      const requireToken = consume("require")!;
      skip();

      if (is("punctuation", "(")) {
        consume("punctuation", "(");
        skip();

        if (is("string")) {
          const pathToken = consume("string")!;
          const path = pathToken.value.slice(1, -1);
          skip();
          consume("punctuation", ")");

          imports.push({
            statement: `require('${path}')`,
            path,
            line: requireToken.line,
            column: requireToken.column,
            type: "require",
          });
        }
      }
      continue;
    }

    // Move to next token
    i++;
  }

  return imports;
}

// ═══════════════════════════════════════════════════════════════════════════
// Export Analysis
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Export 정보
 */
export interface ExportInfo {
  /** Export 유형 */
  type: "named" | "default" | "all" | "type";
  /** Export 이름 (named의 경우) */
  name?: string;
  /** 원본 이름 (as 사용 시) */
  originalName?: string;
  /** re-export 소스 */
  from?: string;
  /** 라인 번호 */
  line: number;
}

/**
 * Export 문 추출
 */
export function extractExportsAST(content: string): ExportInfo[] {
  const tokens = tokenize(content);
  const exports: ExportInfo[] = [];

  let i = 0;

  const skip = () => {
    while (
      i < tokens.length &&
      (tokens[i].type === "whitespace" ||
        tokens[i].type === "newline" ||
        tokens[i].type === "comment")
    ) {
      i++;
    }
  };

  const current = () => tokens[i];
  const is = (type: TokenType, value?: string) => {
    const t = current();
    return t && t.type === type && (value === undefined || t.value === value);
  };
  const consume = (type: TokenType, value?: string) => {
    if (is(type, value)) {
      const t = current();
      i++;
      return t;
    }
    return null;
  };

  while (i < tokens.length && current().type !== "eof") {
    skip();

    if (is("keyword", "export")) {
      const exportToken = consume("keyword", "export")!;
      skip();

      // export default
      if (is("keyword", "default")) {
        consume("keyword", "default");
        exports.push({
          type: "default",
          line: exportToken.line,
        });
        continue;
      }

      // export type
      if (is("keyword", "type")) {
        consume("keyword", "type");
        skip();

        if (is("punctuation", "{")) {
          // export type { ... }
          consume("punctuation", "{");
          skip();

          while (!is("punctuation", "}") && !is("eof")) {
            if (is("identifier")) {
              const name = consume("identifier")!.value;
              skip();

              let originalName: string | undefined;
              if (is("keyword", "as")) {
                consume("keyword", "as");
                skip();
                originalName = name;
                if (is("identifier")) {
                  consume("identifier");
                  skip();
                }
              }

              exports.push({
                type: "type",
                name,
                originalName,
                line: exportToken.line,
              });
            }

            if (is("punctuation", ",")) {
              consume("punctuation", ",");
              skip();
            } else {
              break;
            }
          }
        }
        continue;
      }

      // export * from '...'
      if (is("punctuation", "*")) {
        consume("punctuation", "*");
        skip();

        let from: string | undefined;
        if (is("from")) {
          consume("from");
          skip();
          if (is("string")) {
            from = consume("string")!.value.slice(1, -1);
          }
        }

        exports.push({
          type: "all",
          from,
          line: exportToken.line,
        });
        continue;
      }

      // export { ... }
      if (is("punctuation", "{")) {
        consume("punctuation", "{");
        skip();

        const names: { name: string; originalName?: string }[] = [];

        while (!is("punctuation", "}") && !is("eof")) {
          if (is("identifier")) {
            const name = consume("identifier")!.value;
            skip();

            let originalName: string | undefined;
            if (is("keyword", "as")) {
              consume("keyword", "as");
              skip();
              originalName = name;
              if (is("identifier")) {
                consume("identifier");
                skip();
              }
            }

            names.push({ name, originalName });
          }

          if (is("punctuation", ",")) {
            consume("punctuation", ",");
            skip();
          } else {
            break;
          }
        }

        consume("punctuation", "}");
        skip();

        let from: string | undefined;
        if (is("from")) {
          consume("from");
          skip();
          if (is("string")) {
            from = consume("string")!.value.slice(1, -1);
          }
        }

        for (const { name, originalName } of names) {
          exports.push({
            type: "named",
            name,
            originalName,
            from,
            line: exportToken.line,
          });
        }
        continue;
      }

      // export const/let/var/function/class
      if (
        is("keyword", "const") ||
        is("keyword", "let") ||
        is("keyword", "var") ||
        is("keyword", "function") ||
        is("keyword", "class") ||
        is("keyword", "interface") ||
        is("keyword", "enum") ||
        is("keyword", "async")
      ) {
        consume("keyword");
        skip();

        // async function
        if (is("keyword", "function")) {
          consume("keyword", "function");
          skip();
        }

        if (is("identifier")) {
          const name = consume("identifier")!.value;
          exports.push({
            type: "named",
            name,
            line: exportToken.line,
          });
        }
        continue;
      }
    }

    i++;
  }

  return exports;
}

// ═══════════════════════════════════════════════════════════════════════════
// Module Analysis
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 모듈 분석 결과
 */
export interface ModuleAnalysis {
  /** Import 목록 */
  imports: ImportInfo[];
  /** Export 목록 */
  exports: ExportInfo[];
  /** Public API 여부 (index 파일) */
  isPublicAPI: boolean;
  /** 순수 타입 모듈 여부 */
  isTypeOnly: boolean;
}

/**
 * 모듈 전체 분석
 */
export function analyzeModuleAST(content: string, filePath: string): ModuleAnalysis {
  const imports = extractImportsAST(content);
  const exports = extractExportsAST(content);

  const isPublicAPI =
    filePath.endsWith("/index.ts") ||
    filePath.endsWith("/index.tsx") ||
    filePath.endsWith("/index.js");

  // 타입만 있는 모듈인지 확인
  const hasRuntimeExport = exports.some((e) => e.type !== "type");
  const hasRuntimeImport = imports.some((i) => !i.statement.includes("import type"));
  const isTypeOnly = !hasRuntimeExport && !hasRuntimeImport && exports.length > 0;

  return {
    imports,
    exports,
    isPublicAPI,
    isTypeOnly,
  };
}
