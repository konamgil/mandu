/**
 * Mandu Kitchen DevTools - Source Context Provider
 * @version 1.1.0
 *
 * Dev Server 엔드포인트: 소스 코드 snippet 제공
 * GET /api/__mandu_source__?file=src/components/User.tsx&line=42&context=5
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface SourceContextRequest {
  /** 파일 경로 (프로젝트 루트 기준 상대 경로) */
  file: string;
  /** 하이라이트할 라인 번호 (1-based) */
  line: number;
  /** 전후 컨텍스트 라인 수 (default: 5) */
  context?: number;
}

export interface SourceContextResponse {
  success: boolean;
  data?: {
    filePath: string;
    content: string;
    lineRange: [number, number];
    highlightLine: number;
  };
  error?: string;
}

export interface SourceContextProviderOptions {
  /** 프로젝트 루트 디렉토리 */
  projectRoot: string;
  /** 허용되는 파일 확장자 */
  allowedExtensions?: string[];
  /** 최대 컨텍스트 라인 수 */
  maxContextLines?: number;
  /** 최대 파일 크기 (bytes) */
  maxFileSize?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<Omit<SourceContextProviderOptions, 'projectRoot'>> = {
  allowedExtensions: [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.vue', '.svelte', '.astro',
    '.css', '.scss', '.less',
    '.json', '.yaml', '.yml',
    '.md', '.mdx',
  ],
  maxContextLines: 20,
  maxFileSize: 1024 * 1024, // 1MB
};

// ============================================================================
// Source Context Provider
// ============================================================================

export class SourceContextProvider {
  private options: Required<SourceContextProviderOptions>;

  constructor(options: SourceContextProviderOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /**
   * 소스 코드 컨텍스트 가져오기
   */
  async getSourceContext(request: SourceContextRequest): Promise<SourceContextResponse> {
    const { file, line, context = 5 } = request;

    // 1. 입력 검증
    const validationError = this.validateRequest(file, line, context);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // 2. 파일 경로 확인 (Path Traversal 방지)
    const absolutePath = this.resolveSafePath(file);
    if (!absolutePath) {
      return { success: false, error: 'Invalid file path: path traversal detected' };
    }

    // 3. 파일 존재 확인
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `File not found: ${file}` };
    }

    // 4. 파일 크기 확인
    const stats = fs.statSync(absolutePath);
    if (stats.size > this.options.maxFileSize) {
      return { success: false, error: `File too large: ${file} (${stats.size} bytes)` };
    }

    // 5. 확장자 확인
    const ext = path.extname(file).toLowerCase();
    if (!this.options.allowedExtensions.includes(ext)) {
      return { success: false, error: `Extension not allowed: ${ext}` };
    }

    try {
      // 6. 파일 읽기
      const fileContent = fs.readFileSync(absolutePath, 'utf-8');
      const lines = fileContent.split('\n');

      // 7. 라인 범위 계산
      const effectiveContext = Math.min(context, this.options.maxContextLines);
      const startLine = Math.max(1, line - effectiveContext);
      const endLine = Math.min(lines.length, line + effectiveContext);

      // 8. 컨텍스트 추출
      const contextLines = lines.slice(startLine - 1, endLine);
      const content = contextLines
        .map((l, i) => {
          const lineNum = startLine + i;
          const marker = lineNum === line ? '>' : ' ';
          return `${marker} ${String(lineNum).padStart(4)} | ${l}`;
        })
        .join('\n');

      return {
        success: true,
        data: {
          filePath: file,
          content,
          lineRange: [startLine, endLine],
          highlightLine: line,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 입력 검증
   */
  private validateRequest(file: string, line: number, context: number): string | null {
    if (!file || typeof file !== 'string') {
      return 'Missing or invalid file parameter';
    }

    if (!Number.isInteger(line) || line < 1) {
      return 'Invalid line parameter: must be a positive integer';
    }

    if (!Number.isInteger(context) || context < 0) {
      return 'Invalid context parameter: must be a non-negative integer';
    }

    // 의심스러운 패턴 체크
    if (file.includes('\0') || file.includes('..')) {
      return 'Invalid file path: suspicious pattern detected';
    }

    return null;
  }

  /**
   * 안전한 경로 확인 (Path Traversal 방지)
   */
  private resolveSafePath(file: string): string | null {
    const absolutePath = path.resolve(this.options.projectRoot, file);
    const normalizedRoot = path.normalize(this.options.projectRoot);

    // 확인된 경로가 프로젝트 루트 내에 있는지 확인
    if (!absolutePath.startsWith(normalizedRoot)) {
      return null;
    }

    return absolutePath;
  }

  /**
   * HTTP 요청 핸들러 생성
   */
  createHandler() {
    return async (req: { url?: string }): Promise<SourceContextResponse> => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const file = url.searchParams.get('file');
        const line = parseInt(url.searchParams.get('line') ?? '', 10);
        const context = parseInt(url.searchParams.get('context') ?? '5', 10);

        if (!file) {
          return { success: false, error: 'Missing file parameter' };
        }

        if (isNaN(line)) {
          return { success: false, error: 'Missing or invalid line parameter' };
        }

        return this.getSourceContext({ file, line, context: isNaN(context) ? 5 : context });
      } catch (error) {
        return {
          success: false,
          error: `Handler error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    };
  }
}

// ============================================================================
// Sourcemap Support
// ============================================================================

export interface SourcemapPosition {
  source: string;
  line: number;
  column: number;
  name?: string;
}

export interface SourcemapParseResult {
  success: boolean;
  position?: SourcemapPosition;
  error?: string;
}

/**
 * 간단한 Sourcemap 파서 (Base64 VLQ 디코딩)
 */
export class SourcemapParser {
  private sourcemap: any;

  constructor(sourcemapContent: string) {
    try {
      this.sourcemap = JSON.parse(sourcemapContent);
    } catch {
      throw new Error('Invalid sourcemap JSON');
    }
  }

  /**
   * 생성된 코드의 위치에서 원본 위치 찾기
   */
  getOriginalPosition(line: number, column: number): SourcemapParseResult {
    // 기본 sourcemap 구조 확인
    if (!this.sourcemap.mappings || !this.sourcemap.sources) {
      return { success: false, error: 'Invalid sourcemap structure' };
    }

    try {
      // VLQ 매핑 디코딩
      const mappings = this.decodeMappings(this.sourcemap.mappings);

      // 해당 라인의 매핑 찾기
      if (line < 1 || line > mappings.length) {
        return { success: false, error: 'Line out of range' };
      }

      const lineSegments = mappings[line - 1];
      if (!lineSegments || lineSegments.length === 0) {
        return { success: false, error: 'No mapping for this line' };
      }

      // 가장 가까운 컬럼 매핑 찾기
      let closestSegment = lineSegments[0];
      for (const segment of lineSegments) {
        if (segment.generatedColumn <= column) {
          closestSegment = segment;
        } else {
          break;
        }
      }

      const sourceIndex = closestSegment.sourceIndex ?? 0;
      const source = this.sourcemap.sources[sourceIndex];

      return {
        success: true,
        position: {
          source: source ?? 'unknown',
          line: (closestSegment.originalLine ?? 0) + 1,
          column: closestSegment.originalColumn ?? 0,
          name: closestSegment.nameIndex !== undefined
            ? this.sourcemap.names?.[closestSegment.nameIndex]
            : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Sourcemap parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * VLQ 매핑 디코딩
   */
  private decodeMappings(mappings: string): SourcemapSegment[][] {
    const lines = mappings.split(';');
    const result: SourcemapSegment[][] = [];

    let sourceIndex = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let nameIndex = 0;

    for (const line of lines) {
      const segments: SourcemapSegment[] = [];
      let generatedColumn = 0;

      if (line) {
        const segmentStrs = line.split(',');

        for (const segmentStr of segmentStrs) {
          const values = this.decodeVLQ(segmentStr);

          if (values.length >= 1) {
            generatedColumn += values[0];
          }

          const segment: SourcemapSegment = { generatedColumn };

          if (values.length >= 4) {
            sourceIndex += values[1];
            originalLine += values[2];
            originalColumn += values[3];

            segment.sourceIndex = sourceIndex;
            segment.originalLine = originalLine;
            segment.originalColumn = originalColumn;
          }

          if (values.length >= 5) {
            nameIndex += values[4];
            segment.nameIndex = nameIndex;
          }

          segments.push(segment);
        }
      }

      result.push(segments);
    }

    return result;
  }

  /**
   * Base64 VLQ 디코딩
   */
  private decodeVLQ(str: string): number[] {
    const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const values: number[] = [];
    let shift = 0;
    let value = 0;

    for (const char of str) {
      const digit = BASE64_CHARS.indexOf(char);
      if (digit === -1) continue;

      const continuation = digit & 32;
      value += (digit & 31) << shift;

      if (continuation) {
        shift += 5;
      } else {
        // 부호 비트 처리
        const isNegative = value & 1;
        value = value >> 1;
        values.push(isNegative ? -value : value);
        value = 0;
        shift = 0;
      }
    }

    return values;
  }
}

interface SourcemapSegment {
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
}

// ============================================================================
// Vite Plugin Integration
// ============================================================================

/**
 * Vite 플러그인용 미들웨어 생성
 */
export function createViteMiddleware(projectRoot: string) {
  const provider = new SourceContextProvider({ projectRoot });
  const handler = provider.createHandler();

  return async (req: any, res: any, next: () => void) => {
    // __mandu_source__ 엔드포인트만 처리
    if (!req.url?.startsWith('/api/__mandu_source__')) {
      return next();
    }

    try {
      const result = await handler(req);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = result.success ? 200 : 400;
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({
        success: false,
        error: 'Internal server error',
      }));
    }
  };
}

/**
 * Vite 플러그인 정의
 */
export function manduSourceContextPlugin(options?: Partial<SourceContextProviderOptions>) {
  return {
    name: 'mandu-source-context',

    configureServer(server: any) {
      const projectRoot = options?.projectRoot ?? server.config.root ?? process.cwd();

      server.middlewares.use(createViteMiddleware(projectRoot));
    },
  };
}
