/**
 * File Loader - 단일 파일 로더
 *
 * JSON, YAML, TOML 파일을 로드하고 파싱
 *
 * @example
 * ```ts
 * file({ path: 'data/settings.json' })
 * file({ path: 'config/app.yaml' })
 * ```
 */

import type { Loader, FileLoaderOptions } from "./types";
import type { LoaderContext } from "../types";
import { LoaderError, ParseError } from "../types";
import { generateFileDigest } from "../digest";
import { inferParser } from "./types";
import * as fs from "fs";
import * as path from "path";

/**
 * JSON 파싱
 */
function parseJson(content: string, filePath: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ParseError(
      `Failed to parse JSON: ${error instanceof Error ? error.message : error}`,
      undefined,
      filePath
    );
  }
}

/**
 * YAML 파싱 (동적 임포트)
 */
async function parseYaml(content: string, filePath: string): Promise<unknown> {
  try {
    // yaml 패키지 동적 로드
    const yaml = await import("yaml").catch(() => null);

    if (!yaml) {
      throw new Error("yaml package not installed. Run: pnpm add yaml");
    }

    return yaml.parse(content);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not installed")) {
      throw error;
    }
    throw new ParseError(
      `Failed to parse YAML: ${error instanceof Error ? error.message : error}`,
      undefined,
      filePath
    );
  }
}

/**
 * TOML 파싱 (동적 임포트)
 */
async function parseToml(content: string, filePath: string): Promise<unknown> {
  try {
    // @iarna/toml 또는 toml 패키지 동적 로드
    const toml = await import("@iarna/toml").catch(() =>
      import("toml").catch(() => null)
    );

    if (!toml) {
      throw new Error("toml package not installed. Run: pnpm add @iarna/toml");
    }

    return toml.parse(content);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not installed")) {
      throw error;
    }
    throw new ParseError(
      `Failed to parse TOML: ${error instanceof Error ? error.message : error}`,
      undefined,
      filePath
    );
  }
}

/**
 * File Loader 팩토리
 */
export function file(options: FileLoaderOptions): Loader {
  const { path: filePath, parser: explicitParser } = options;

  return {
    name: "file",

    async load(context: LoaderContext): Promise<void> {
      const { store, config, logger, parseData, generateDigest } = context;

      // 절대 경로 계산
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(config.root, filePath);

      // 파일 존재 확인
      if (!fs.existsSync(absolutePath)) {
        throw new LoaderError(
          `File not found: ${absolutePath}`,
          context.collection
        );
      }

      // 파일 읽기
      const content = fs.readFileSync(absolutePath, "utf-8");

      // 다이제스트 생성
      const digest = generateFileDigest(content);

      // 기존 엔트리와 비교
      const existingEntry = store.get("_single");
      if (existingEntry?.digest === digest) {
        logger.debug("File unchanged, skipping parse");
        return;
      }

      // 파서 결정
      const parserType = explicitParser ?? inferParser(absolutePath);

      if (!parserType || parserType === "markdown") {
        throw new LoaderError(
          `Cannot determine parser for file: ${absolutePath}. Use .json, .yaml, .yml, or .toml extension, or specify parser option.`,
          context.collection
        );
      }

      // 파싱
      let rawData: unknown;

      switch (parserType) {
        case "json":
          rawData = parseJson(content, absolutePath);
          break;
        case "yaml":
          rawData = await parseYaml(content, absolutePath);
          break;
        case "toml":
          rawData = await parseToml(content, absolutePath);
          break;
      }

      // 스키마 검증
      const data = await parseData({
        id: "_single",
        data: rawData,
        filePath: absolutePath,
      });

      // 저장
      store.set({
        id: "_single",
        data: data as Record<string, unknown>,
        filePath: absolutePath,
        digest,
      });

      logger.info(`Loaded file: ${filePath}`);
    },
  };
}
