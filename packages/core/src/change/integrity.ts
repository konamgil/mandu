import { createHash } from "crypto";
import path from "path";

/**
 * 파일의 SHA-256 해시를 계산
 */
export async function computeFileHash(filePath: string): Promise<string> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await file.text();
    return createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("File not found")) {
      throw error;
    }
    throw new Error(
      `Failed to compute hash for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 여러 파일의 해시를 수집
 * @param rootDir 프로젝트 루트 디렉토리
 * @param relativePaths 상대 경로 배열
 * @returns 상대 경로 → 해시 맵
 */
export async function collectFileHashes(
  rootDir: string,
  relativePaths: string[]
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  await Promise.all(
    relativePaths.map(async (relativePath) => {
      const absolutePath = path.join(rootDir, relativePath);
      try {
        const hash = await computeFileHash(absolutePath);
        hashes[relativePath] = hash;
      } catch {
        // 파일이 없는 경우 무시 (스냅샷 시점에 없었을 수 있음)
      }
    })
  );

  return hashes;
}

/**
 * 디렉토리 내 모든 파일 경로를 재귀적으로 수집
 */
export async function collectFilePaths(
  dirPath: string,
  basePath: string = dirPath
): Promise<string[]> {
  const paths: string[] = [];

  try {
    const entries = await Array.fromAsync(
      new Bun.Glob("**/*").scan({
        cwd: dirPath,
        onlyFiles: true,
      })
    );

    for (const entry of entries) {
      const relativePath = path.relative(basePath, path.join(dirPath, entry));
      paths.push(relativePath);
    }
  } catch {
    // 디렉토리가 없는 경우 빈 배열 반환
  }

  return paths;
}
