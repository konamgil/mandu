/**
 * Mandu Bundler Types
 */

/**
 * 번들 빌드 결과
 */
export interface BundleResult {
  success: boolean;
  outputs: BundleOutput[];
  errors: string[];
  manifest: BundleManifest;
  stats: BundleStats;
}

/**
 * 개별 번들 출력
 */
export interface BundleOutput {
  /** 라우트 ID */
  routeId: string;
  /** 원본 엔트리포인트 */
  entrypoint: string;
  /** 출력 경로 (서버 기준) */
  outputPath: string;
  /** 파일 크기 (bytes) */
  size: number;
  /** gzip 압축 크기 (bytes) */
  gzipSize: number;
}

/**
 * 번들 매니페스트
 */
export interface BundleManifest {
  /** 매니페스트 버전 */
  version: number;
  /** 빌드 시간 */
  buildTime: string;
  /** 환경 */
  env: "development" | "production";
  /** 라우트별 번들 정보 */
  bundles: Record<
    string,
    {
      /** JavaScript 번들 경로 */
      js: string;
      /** CSS 번들 경로 (있는 경우) */
      css?: string;
      /** 의존하는 공유 청크 */
      dependencies: string[];
      /** Hydration 우선순위 */
      priority: "immediate" | "visible" | "idle" | "interaction";
    }
  >;
  /** 공유 청크 */
  shared: {
    /** Hydration 런타임 */
    runtime: string;
    /** React 번들 경로 */
    vendor: string;
    /** Client-side Router 런타임 */
    router?: string;
  };
  /** Import map for bare specifiers (react, react-dom, etc.) */
  importMap?: {
    imports: Record<string, string>;
  };
}

/**
 * 번들 통계
 */
export interface BundleStats {
  /** 전체 크기 */
  totalSize: number;
  /** 전체 gzip 크기 */
  totalGzipSize: number;
  /** 가장 큰 번들 */
  largestBundle: {
    routeId: string;
    size: number;
  };
  /** 빌드 시간 (ms) */
  buildTime: number;
  /** 번들 수 */
  bundleCount: number;
}

/**
 * 번들러 옵션
 */
export interface BundlerOptions {
  /** 코드 압축 여부 (기본: production에서 true) */
  minify?: boolean;
  /** 소스맵 생성 여부 */
  sourcemap?: boolean;
  /** 파일 감시 모드 */
  watch?: boolean;
  /** 출력 디렉토리 (기본: .mandu/client) */
  outDir?: string;
  /** 외부 모듈 (번들에서 제외) */
  external?: string[];
  /** 환경 변수 주입 */
  define?: Record<string, string>;
}
