/**
 * Glob Loader - 패턴 매칭 파일 로더
 *
 * Glob 패턴으로 여러 파일을 로드 (Markdown, JSON 등)
 *
 * @example
 * ```ts
 * glob({ pattern: 'content/posts/**\/*.md' })
 * glob({ pattern: ['content/blog/**\/*.md', 'content/news/**\/*.md'] })
 * ```
 */

import type { Loader, GlobLoaderOptions, ParsedMarkdown } from "./types";
import type { LoaderContext, DataEntry } from "../types";
import { LoaderError, ParseError } from "../types";
import { generateFileDigest, combineDigests } from "../digest";
import { inferParser, MARKDOWN_EXTENSIONS } from "./types";
import * as fs from "fs";
import * as path from "path";

// fast-glob 동적 임포트
async function fastGlob(patterns: string[], options: { onlyFiles: boolean; absolute: boolean }): Promise<string[]> {
  const fg = await import("fast-glob");
  return fg.glob(patterns, options);
}

/**
 * 프론트매터 파싱 (---로 구분된 YAML)
 */
async function parseFrontmatter(
  content: string,
  filePath: string
): Promise<ParsedMarkdown> {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    // 프론트매터 없음
    return {
      data: {},
      body: content.trim(),
    };
  }

  const [, rawFrontmatter, body] = match;

  try {
    // yaml 동적 로드
    // @ts-ignore dynamic optional import
    const yaml = await import("yaml").catch(() => null);

    if (!yaml) {
      // yaml 없으면 빈 데이터 반환
      console.warn(
        `[GlobLoader] yaml package not installed, frontmatter ignored for ${filePath}`
      );
      return {
        data: {},
        body: body.trim(),
        rawFrontmatter,
      };
    }

    const data = yaml.parse(rawFrontmatter) || {};

    return {
      data: typeof data === "object" ? data : {},
      body: body.trim(),
      rawFrontmatter,
    };
  } catch (error) {
    throw new ParseError(
      `Failed to parse frontmatter: ${error instanceof Error ? error.message : error}`,
      undefined,
      filePath
    );
  }
}

/**
 * 파일 경로에서 ID 생성 (기본)
 */
function defaultGenerateId(params: { filePath: string; base: string }): string {
  const { filePath, base } = params;

  // base 기준 상대 경로
  const relativePath = path.relative(base, filePath);

  // 확장자 제거, 경로 구분자를 슬래시로 통일
  const withoutExt = relativePath.replace(/\.[^.]+$/, "");
  const normalized = withoutExt.replace(/\\/g, "/");

  // index 파일은 상위 폴더명 사용
  if (normalized.endsWith("/index")) {
    return normalized.slice(0, -6) || "index";
  }

  return normalized;
}

/**
 * Glob Loader 팩토리
 */
export function glob(options: GlobLoaderOptions): Loader {
  const { pattern, base, generateId = defaultGenerateId } = options;

  return {
    name: "glob",

    async load(context: LoaderContext): Promise<void> {
      const { store, config, logger, parseData, renderMarkdown, watcher } = context;

      // 기본 디렉토리
      const baseDir = base
        ? path.isAbsolute(base)
          ? base
          : path.join(config.root, base)
        : config.root;

      // 패턴 배열로 통일
      const patterns = Array.isArray(pattern) ? pattern : [pattern];

      // 절대 패턴으로 변환
      const absolutePatterns = patterns.map((p) =>
        path.isAbsolute(p) ? p : path.join(config.root, p)
      );

      // 파일 검색
      const filePaths = await fastGlob(absolutePatterns, {
        onlyFiles: true,
        absolute: true,
      });

      if (filePaths.length === 0) {
        logger.warn(`No files matched pattern: ${patterns.join(", ")}`);
        return;
      }

      // 파일 감시 추가 (dev 모드)
      if (watcher) {
        watcher.add(absolutePatterns);
      }

      // 기존 엔트리 ID 수집 (삭제 감지용)
      const existingIds = new Set(store.keys());
      const processedIds = new Set<string>();

      // 병렬 처리
      await Promise.all(
        filePaths.map(async (filePath) => {
          const id = generateId({ filePath, base: baseDir });
          processedIds.add(id);

          try {
            await processFile(context, filePath, id, baseDir);
          } catch (error) {
            logger.error(
              `Failed to process ${filePath}: ${error instanceof Error ? error.message : error}`
            );
          }
        })
      );

      // 삭제된 파일 처리
      for (const id of existingIds) {
        if (!processedIds.has(id)) {
          store.delete(id);
          logger.debug(`Removed deleted entry: ${id}`);
        }
      }

      logger.info(`Processed ${processedIds.size} files`);
    },
  };
}

/**
 * 단일 파일 처리
 */
async function processFile(
  context: LoaderContext,
  filePath: string,
  id: string,
  baseDir: string
): Promise<void> {
  const { store, parseData, renderMarkdown, logger } = context;

  // 파일 읽기
  const content = fs.readFileSync(filePath, "utf-8");
  const fileDigest = generateFileDigest(content);

  // 기존 엔트리와 비교
  const existingEntry = store.get(id);
  if (existingEntry?.digest === fileDigest) {
    logger.debug(`Unchanged: ${id}`);
    return;
  }

  // 파서 타입 결정
  const parserType = inferParser(filePath);

  let entry: DataEntry;

  if (parserType === "markdown") {
    // Markdown 파일 처리
    const parsed = await parseFrontmatter(content, filePath);

    // 프론트매터 검증
    const data = await parseData({
      id,
      data: parsed.data,
      filePath,
    });

    // 다이제스트 (프론트매터 + 본문)
    const digest = combineDigests([
      fileDigest,
      context.generateDigest(parsed.data),
    ]);

    entry = {
      id,
      data: data as Record<string, unknown>,
      filePath,
      body: parsed.body,
      digest,
    };

    // Markdown 렌더링 (옵션)
    if (renderMarkdown) {
      entry.rendered = await renderMarkdown(parsed.body);
    }
  } else if (parserType === "json") {
    // JSON 파일
    const rawData = JSON.parse(content);
    const data = await parseData({ id, data: rawData, filePath });

    entry = {
      id,
      data: data as Record<string, unknown>,
      filePath,
      digest: fileDigest,
    };
  } else {
    // 지원하지 않는 파일 타입
    logger.warn(`Unsupported file type: ${filePath}`);
    return;
  }

  // 저장
  store.set(entry);
  logger.debug(`Processed: ${id}`);
}
