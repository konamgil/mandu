/**
 * 안전한 파일 I/O 유틸리티
 *
 * Result<T> 패턴을 사용하여 에러 정보를 보존합니다.
 * try-catch 대신 이 함수들을 사용하면 에러 컨텍스트가 유지됩니다.
 */

import { readFile, readdir, access, stat } from "fs/promises";
import type { Dirent, Stats } from "fs";
import type { Result } from "../error/result";
import { ok, err } from "../error/result";
import { FileError, DirectoryError } from "../error/domains";

// ============================================================
// 파일 읽기
// ============================================================

/**
 * 안전한 파일 읽기 (텍스트)
 *
 * @example
 * const result = await safeReadFile("path/to/file.ts");
 * if (!result.ok) {
 *   console.error(result.error.message);
 *   return;
 * }
 * const content = result.value;
 */
export async function safeReadFile(filePath: string): Promise<Result<string>> {
  try {
    const content = await readFile(filePath, "utf-8");
    return ok(content);
  } catch (e) {
    return err(new FileError(filePath, "read", e).toManduError());
  }
}

/**
 * 안전한 파일 읽기 (Bun 최적화 버전)
 * Bun.file().text()는 readFile보다 빠릅니다.
 */
export async function safeReadFileBun(filePath: string): Promise<Result<string>> {
  try {
    const content = await Bun.file(filePath).text();
    return ok(content);
  } catch (e) {
    return err(new FileError(filePath, "read", e).toManduError());
  }
}

/**
 * 파일 존재 여부 확인
 */
export async function safeFileExists(filePath: string): Promise<Result<boolean>> {
  try {
    await access(filePath);
    return ok(true);
  } catch (e) {
    // ENOENT는 정상적인 "없음" 상태
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return ok(false);
    }
    // 그 외는 실제 에러 (권한 등)
    return err(new FileError(filePath, "access", e).toManduError());
  }
}

/**
 * 파일 정보 조회
 */
export async function safeFileStat(filePath: string): Promise<Result<Stats>> {
  try {
    const stats = await stat(filePath);
    return ok(stats);
  } catch (e) {
    return err(new FileError(filePath, "stat", e).toManduError());
  }
}

// ============================================================
// 디렉토리 읽기
// ============================================================

/**
 * 안전한 디렉토리 읽기
 */
export async function safeReadDir(dirPath: string): Promise<Result<string[]>> {
  try {
    const entries = await readdir(dirPath);
    return ok(entries);
  } catch (e) {
    return err(new DirectoryError(dirPath, e).toManduError());
  }
}

/**
 * 안전한 디렉토리 읽기 (Dirent 포함)
 */
export async function safeReadDirWithTypes(
  dirPath: string
): Promise<Result<Dirent[]>> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return ok(entries);
  } catch (e) {
    return err(new DirectoryError(dirPath, e).toManduError());
  }
}

// ============================================================
// 조합 유틸리티
// ============================================================

/**
 * 여러 파일을 병렬로 읽기
 *
 * @returns 성공한 파일들만 반환, 실패는 errors에 수집
 */
export async function safeReadFiles(
  filePaths: string[]
): Promise<{
  results: Map<string, string>;
  errors: Map<string, Error>;
}> {
  const results = new Map<string, string>();
  const errors = new Map<string, Error>();

  await Promise.all(
    filePaths.map(async (filePath) => {
      const result = await safeReadFileBun(filePath);
      if (result.ok) {
        results.set(filePath, result.value);
      } else {
        errors.set(filePath, new Error(result.error.message));
      }
    })
  );

  return { results, errors };
}

/**
 * 파일이 있으면 읽고, 없으면 기본값 반환
 */
export async function safeReadFileOrDefault(
  filePath: string,
  defaultValue: string
): Promise<string> {
  const result = await safeReadFileBun(filePath);
  return result.ok ? result.value : defaultValue;
}

/**
 * 디렉토리의 모든 파일 경로 수집 (재귀)
 */
export async function safeGlobDir(
  dirPath: string,
  pattern?: RegExp
): Promise<Result<string[]>> {
  const result = await safeReadDirWithTypes(dirPath);
  if (!result.ok) return result;

  const files: string[] = [];
  const subDirPromises: Promise<Result<string[]>>[] = [];

  for (const entry of result.value) {
    const fullPath = `${dirPath}/${entry.name}`;

    if (entry.isDirectory()) {
      subDirPromises.push(safeGlobDir(fullPath, pattern));
    } else if (entry.isFile()) {
      if (!pattern || pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  // 서브 디렉토리 결과 수집
  const subResults = await Promise.all(subDirPromises);
  for (const subResult of subResults) {
    if (subResult.ok) {
      files.push(...subResult.value);
    }
    // 서브 디렉토리 에러는 무시 (접근 불가 디렉토리 스킵)
  }

  return ok(files);
}
