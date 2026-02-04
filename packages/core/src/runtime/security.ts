/**
 * Runtime Security
 *
 * 동적 import 및 경로 접근 보안 검증
 */

import path from "path";
import type { Result } from "../error/result";
import { ok, err } from "../error/result";
import { SecurityError } from "../error/domains";

/**
 * 허용된 import 경로 패턴
 */
const ALLOWED_IMPORT_PATTERNS = [
  /^app\//,           // app/ 디렉토리 (FS Routes)
  /^src\/client\//,   // 클라이언트 코드
  /^src\/server\//,   // 서버 코드
  /^src\/shared\//,   // 공유 코드
  /^spec\//,          // Spec 디렉토리 (레거시)
];

/**
 * 허용된 파일 확장자
 */
const ALLOWED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/**
 * 차단된 경로 패턴
 */
const BLOCKED_PATTERNS = [
  /node_modules/,     // node_modules 직접 접근 차단
  /\.env/,            // 환경 변수 파일
  /\.git/,            // Git 디렉토리
  /\.mandu\/.*\.json$/, // 설정 파일
];

/**
 * 동적 import 경로 검증
 *
 * @param rootDir 프로젝트 루트 디렉토리
 * @param modulePath 상대 모듈 경로 (예: "app/layout.tsx")
 * @returns 검증된 전체 경로 또는 에러
 */
export function validateImportPath(
  rootDir: string,
  modulePath: string
): Result<string> {
  // 1. 경로 정규화
  const normalized = path.posix.normalize(modulePath).replace(/\\/g, "/");

  // 2. Path traversal 체크
  if (normalized.includes("..")) {
    return err(
      new SecurityError(
        "path_traversal",
        `경로 탐색 공격 감지: ${modulePath}`,
        modulePath
      ).toManduError()
    );
  }

  // 3. 차단된 패턴 체크
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return err(
        new SecurityError(
          "import_violation",
          `차단된 경로 접근: ${modulePath}`,
          modulePath
        ).toManduError()
      );
    }
  }

  // 4. 화이트리스트 검증
  const isAllowed = ALLOWED_IMPORT_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );

  if (!isAllowed) {
    return err(
      new SecurityError(
        "import_violation",
        `허용되지 않은 import 경로: ${modulePath}. 허용된 경로: app/, src/client/, src/server/, src/shared/, spec/`,
        modulePath
      ).toManduError()
    );
  }

  // 5. 확장자 검증 (있는 경우만)
  const ext = path.extname(normalized);
  if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
    return err(
      new SecurityError(
        "import_violation",
        `허용되지 않은 파일 확장자: ${ext}`,
        modulePath
      ).toManduError()
    );
  }

  // 6. 전체 경로 생성
  const fullPath = path.join(rootDir, normalized);

  // 7. 최종 경로가 rootDir 내에 있는지 확인
  const resolvedPath = path.resolve(fullPath);
  const resolvedRoot = path.resolve(rootDir);

  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return err(
      new SecurityError(
        "path_traversal",
        `루트 디렉토리 외부 접근 시도: ${modulePath}`,
        modulePath
      ).toManduError()
    );
  }

  return ok(fullPath);
}

/**
 * 안전한 동적 import
 *
 * @param rootDir 프로젝트 루트 디렉토리
 * @param modulePath 상대 모듈 경로
 * @returns 로드된 모듈 또는 null
 */
export async function safeImport<T = unknown>(
  rootDir: string,
  modulePath: string
): Promise<T | null> {
  const validation = validateImportPath(rootDir, modulePath);

  if (!validation.ok) {
    console.error(`[Mandu Security] ${validation.error.message}`);
    return null;
  }

  try {
    const module = await import(validation.value);
    return module as T;
  } catch (error) {
    console.error(`[Mandu] Failed to import: ${modulePath}`, error);
    return null;
  }
}

/**
 * 모듈 경로 검증 (boolean 반환)
 */
export function isValidImportPath(rootDir: string, modulePath: string): boolean {
  return validateImportPath(rootDir, modulePath).ok;
}
