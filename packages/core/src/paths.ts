import path from "path";

/**
 * 프레임워크가 생성하는 파일들의 경로 구조
 * apps/ 하드코딩 대신 .mandu/ 기반 중앙 관리
 */
export interface GeneratedPaths {
  /** 서버 라우트 핸들러 디렉토리 */
  serverRoutesDir: string;
  /** 웹 라우트 컴포넌트 디렉토리 */
  webRoutesDir: string;
  /** 타입 글루 디렉토리 */
  typesDir: string;
  /** 생성 맵 디렉토리 */
  mapDir: string;
  /** 생성된 매니페스트 경로 */
  manifestPath: string;
  /** 생성된 lock 경로 */
  lockPath: string;
}

/**
 * 프로젝트 루트에서 생성 경로를 결정
 */
export function resolveGeneratedPaths(rootDir: string): GeneratedPaths {
  return {
    serverRoutesDir: path.join(rootDir, ".mandu/generated/server/routes"),
    webRoutesDir: path.join(rootDir, ".mandu/generated/web/routes"),
    typesDir: path.join(rootDir, ".mandu/generated/server/types"),
    mapDir: path.join(rootDir, ".mandu/generated"),
    manifestPath: path.join(rootDir, ".mandu/routes.manifest.json"),
    lockPath: path.join(rootDir, ".mandu/spec.lock.json"),
  };
}

/**
 * 생성된 파일의 상대 경로 (generatedMap.files 키 등에 사용)
 */
export const GENERATED_RELATIVE_PATHS = {
  serverRoutes: ".mandu/generated/server/routes",
  webRoutes: ".mandu/generated/web/routes",
  types: ".mandu/generated/server/types",
  map: ".mandu/generated",
  manifest: ".mandu/routes.manifest.json",
  lock: ".mandu/spec.lock.json",
  history: ".mandu/history",
} as const;
