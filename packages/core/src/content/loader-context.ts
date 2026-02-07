/**
 * LoaderContext Factory - 로더에 전달되는 컨텍스트 생성
 *
 * 각 컬렉션의 load() 함수에 필요한 모든 유틸리티 제공
 */

import type {
  LoaderContext,
  DataStore,
  MetaStore,
  ContentLogger,
  ManduContentConfig,
  ContentWatcher,
  ParseDataOptions,
  RenderedContent,
  ValidationError as ContentValidationError,
} from "./types";
import { ValidationError } from "./types";
import { generateDigest } from "./digest";
import type { ZodSchema } from "zod";

/**
 * LoaderContext 생성 옵션
 */
export interface CreateLoaderContextOptions {
  /** 컬렉션 이름 */
  collection: string;
  /** 데이터 스토어 */
  store: DataStore;
  /** 메타 스토어 */
  meta: MetaStore;
  /** Mandu 설정 */
  config: ManduContentConfig;
  /** Zod 스키마 (검증용) */
  schema?: ZodSchema;
  /** Markdown 렌더러 */
  markdownRenderer?: (content: string) => Promise<RenderedContent>;
  /** 파일 감시자 */
  watcher?: ContentWatcher;
  /** 로거 (기본: console) */
  logger?: ContentLogger;
}

/**
 * 기본 콘텐츠 로거
 */
function createDefaultLogger(collection: string): ContentLogger {
  const prefix = `[Content:${collection}]`;

  return {
    info: (msg) => console.log(`${prefix} ${msg}`),
    warn: (msg) => console.warn(`${prefix} ${msg}`),
    error: (msg) => console.error(`${prefix} ${msg}`),
    debug: (msg) => {
      if (process.env.DEBUG || process.env.NODE_ENV === "development") {
        console.debug(`${prefix} ${msg}`);
      }
    },
  };
}

/**
 * LoaderContext 생성
 */
export function createLoaderContext(options: CreateLoaderContextOptions): LoaderContext {
  const {
    collection,
    store,
    meta,
    config,
    schema,
    markdownRenderer,
    watcher,
    logger = createDefaultLogger(collection),
  } = options;

  /**
   * 데이터 파싱 및 검증
   */
  async function parseData<T>(parseOptions: ParseDataOptions<T>): Promise<T> {
    const { id, data, filePath } = parseOptions;

    if (!schema) {
      // 스키마 없으면 그대로 반환
      return data as T;
    }

    const result = await schema.safeParseAsync(data);

    if (!result.success) {
      const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");

      throw new ValidationError(
        `Validation failed for entry "${id}"${filePath ? ` (${filePath})` : ""}: ${errorMessage}`,
        result.error,
        collection,
        id
      );
    }

    return result.data as T;
  }

  const context: LoaderContext = {
    collection,
    store,
    meta,
    logger,
    config,
    parseData,
    generateDigest: (data: unknown) => generateDigest(data),
    watcher,
  };

  // Markdown 렌더러가 있으면 추가
  if (markdownRenderer) {
    context.renderMarkdown = markdownRenderer;
  }

  return context;
}

/**
 * 간단한 Markdown 렌더러 (기본 제공)
 *
 * 실제 프로젝트에서는 remark/rehype 파이프라인으로 교체 권장
 */
export function createSimpleMarkdownRenderer(): (content: string) => Promise<RenderedContent> {
  return async (content: string): Promise<RenderedContent> => {
    // 매우 기본적인 Markdown → HTML 변환
    // 실제 사용 시 marked, remark 등으로 교체
    const html = content
      // 헤딩
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      // 볼드/이탤릭
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // 링크
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // 코드 블록
      .replace(/```([^`]+)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // 줄바꿈
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    // 헤딩 추출
    const headings: Array<{ depth: 1 | 2 | 3 | 4 | 5 | 6; slug: string; text: string }> = [];
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      const depth = match[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = match[2].trim();
      const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, "-")
        .replace(/^-|-$/g, "");

      headings.push({ depth, slug, text });
    }

    return {
      html: `<p>${html}</p>`,
      headings,
    };
  };
}
