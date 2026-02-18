/**
 * DNA-002: Dependency Injection Pattern
 *
 * Filling 핸들러의 의존성을 명시적으로 주입
 * - 테스트 시 목킹 용이
 * - 의존성 역전 원칙 (DIP) 준수
 * - 외부 서비스와의 결합도 감소
 */

/**
 * 데이터베이스 의존성 인터페이스
 */
export interface DbDeps {
  /**
   * SQL 쿼리 실행
   */
  query: <T>(sql: string, params?: unknown[]) => Promise<T>;

  /**
   * 트랜잭션 실행
   */
  transaction: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * 캐시 의존성 인터페이스
 */
export interface CacheDeps {
  /**
   * 캐시에서 값 조회
   */
  get: <T>(key: string) => Promise<T | null>;

  /**
   * 캐시에 값 저장
   * @param ttl - Time to live (초 단위)
   */
  set: <T>(key: string, value: T, ttl?: number) => Promise<void>;

  /**
   * 캐시에서 값 삭제
   */
  delete: (key: string) => Promise<void>;

  /**
   * 패턴에 맞는 키 삭제
   */
  deletePattern?: (pattern: string) => Promise<void>;
}

/**
 * 로거 의존성 인터페이스
 */
export interface LoggerDeps {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

/**
 * 이벤트 버스 의존성 인터페이스
 */
export interface EventBusDeps {
  /**
   * 이벤트 발행
   */
  emit: (event: string, payload: unknown) => void;

  /**
   * 이벤트 구독
   */
  on: (event: string, handler: (payload: unknown) => void) => () => void;
}

/**
 * Filling 핸들러 의존성 타입
 *
 * 모든 필드는 선택적 → 필요한 것만 주입
 */
export interface FillingDeps {
  /**
   * 데이터베이스 접근
   */
  db?: DbDeps;

  /**
   * 캐시 접근
   */
  cache?: CacheDeps;

  /**
   * HTTP 클라이언트
   */
  fetch?: typeof fetch;

  /**
   * 로거
   */
  logger?: LoggerDeps;

  /**
   * 이벤트 버스
   */
  events?: EventBusDeps;

  /**
   * 현재 시간 (테스트용)
   */
  now?: () => Date;

  /**
   * UUID 생성 (테스트용)
   */
  uuid?: () => string;

  /**
   * 커스텀 의존성
   */
  [key: string]: unknown;
}

/**
 * 기본 의존성 생성
 *
 * @example
 * ```ts
 * const deps = createDefaultDeps();
 * console.log(deps.now()); // 현재 시간
 * ```
 */
export function createDefaultDeps(): FillingDeps {
  return {
    fetch: globalThis.fetch,
    logger: {
      debug: (msg, data) => console.debug(`[DEBUG] ${msg}`, data ?? ""),
      info: (msg, data) => console.info(`[INFO] ${msg}`, data ?? ""),
      warn: (msg, data) => console.warn(`[WARN] ${msg}`, data ?? ""),
      error: (msg, data) => console.error(`[ERROR] ${msg}`, data ?? ""),
    },
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}

/**
 * 테스트용 목 의존성 생성 헬퍼
 *
 * @example
 * ```ts
 * const mockDeps = createMockDeps({
 *   db: {
 *     query: vi.fn().mockResolvedValue([{ id: 1, name: "Test" }]),
 *     transaction: vi.fn(fn => fn()),
 *   },
 *   now: () => new Date("2025-01-01"),
 * });
 * ```
 */
export function createMockDeps(overrides: Partial<FillingDeps> = {}): FillingDeps {
  const noop = () => {};
  const asyncNoop = async () => {};

  return {
    db: {
      query: async () => [] as never,
      transaction: async (fn) => fn(),
    },
    cache: {
      get: async () => null,
      set: asyncNoop,
      delete: asyncNoop,
    },
    fetch: Object.assign(
      async (): Promise<Response> => new Response(),
      { preconnect: (_url: string) => {} }
    ) as typeof fetch,
    logger: {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    },
    events: {
      emit: noop,
      on: () => noop,
    },
    now: () => new Date("2025-01-01T00:00:00Z"),
    uuid: () => "00000000-0000-0000-0000-000000000000",
    ...overrides,
  };
}

/**
 * 의존성 병합 (기본값 + 커스텀)
 */
export function mergeDeps(
  base: FillingDeps,
  overrides: Partial<FillingDeps>
): FillingDeps {
  return { ...base, ...overrides };
}

/**
 * 의존성 컨테이너 (싱글톤 관리)
 */
class DepsContainer {
  private deps: FillingDeps = createDefaultDeps();

  /**
   * 전역 의존성 설정
   */
  set(deps: Partial<FillingDeps>): void {
    this.deps = mergeDeps(this.deps, deps);
  }

  /**
   * 전역 의존성 가져오기
   */
  get(): FillingDeps {
    return this.deps;
  }

  /**
   * 기본값으로 리셋
   */
  reset(): void {
    this.deps = createDefaultDeps();
  }
}

/**
 * 전역 의존성 컨테이너
 */
export const globalDeps = new DepsContainer();

/**
 * 의존성 주입 데코레이터 타입
 * (향후 클래스 기반 핸들러 지원 시)
 */
export type InjectDeps<T extends keyof FillingDeps> = Pick<FillingDeps, T>;
