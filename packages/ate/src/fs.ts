import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AtePaths } from "./types";

export class ATEFileError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ATEFileError";
  }
}

export function getAtePaths(repoRoot: string): AtePaths {
  const manduDir = join(repoRoot, ".mandu");
  return {
    repoRoot,
    manduDir,
    interactionGraphPath: join(manduDir, "interaction-graph.json"),
    selectorMapPath: join(manduDir, "selector-map.json"),
    scenariosPath: join(manduDir, "scenarios", "generated.json"),
    reportsDir: join(manduDir, "reports"),
    autoE2eDir: join(repoRoot, "tests", "e2e", "auto"),
    manualE2eDir: join(repoRoot, "tests", "e2e", "manual"),
  };
}

/**
 * 디렉토리 생성 (재귀적)
 * @throws ATEFileError - 권한 없음 또는 파일 시스템 에러
 */
export function ensureDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (err: any) {
    if (err.code === "EACCES") {
      throw new ATEFileError(
        `디렉토리 생성 권한이 없습니다: ${path}`,
        "PERMISSION_DENIED",
        path,
      );
    }
    if (err.code === "ENOSPC") {
      throw new ATEFileError(
        `디스크 공간이 부족합니다: ${path}`,
        "NO_SPACE",
        path,
      );
    }
    throw new ATEFileError(
      `디렉토리 생성 실패: ${path} (${err.message})`,
      err.code || "UNKNOWN",
      path,
    );
  }
}

/**
 * JSON 파일 쓰기
 * @throws ATEFileError - 파일 쓰기 실패
 */
export function writeJson(path: string, data: unknown): void {
  try {
    ensureDir(dirname(path));
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  } catch (err: any) {
    if (err instanceof ATEFileError) {
      throw err;
    }
    if (err.code === "EACCES") {
      throw new ATEFileError(
        `파일 쓰기 권한이 없습니다: ${path}`,
        "PERMISSION_DENIED",
        path,
      );
    }
    if (err.code === "ENOSPC") {
      throw new ATEFileError(
        `디스크 공간이 부족합니다: ${path}`,
        "NO_SPACE",
        path,
      );
    }
    throw new ATEFileError(
      `JSON 파일 쓰기 실패: ${path} (${err.message})`,
      err.code || "UNKNOWN",
      path,
    );
  }
}

/**
 * JSON 파일 읽기
 * @throws ATEFileError - 파일 없음, 읽기 실패, JSON 파싱 실패
 */
export function readJson<T>(path: string): T {
  try {
    if (!existsSync(path)) {
      throw new ATEFileError(
        `파일을 찾을 수 없습니다: ${path}`,
        "FILE_NOT_FOUND",
        path,
      );
    }

    const content = readFileSync(path, "utf8");
    return JSON.parse(content) as T;
  } catch (err: any) {
    if (err instanceof ATEFileError) {
      throw err;
    }
    if (err.code === "EACCES") {
      throw new ATEFileError(
        `파일 읽기 권한이 없습니다: ${path}`,
        "PERMISSION_DENIED",
        path,
      );
    }
    if (err instanceof SyntaxError) {
      throw new ATEFileError(
        `잘못된 JSON 형식입니다: ${path}`,
        "INVALID_JSON",
        path,
      );
    }
    throw new ATEFileError(
      `JSON 파일 읽기 실패: ${path} (${err.message})`,
      err.code || "UNKNOWN",
      path,
    );
  }
}

/**
 * 파일 존재 여부 확인 (안전)
 */
export function fileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}
