/**
 * DNA-008: Structured Logging - Transport System
 *
 * 로그 전송 레지스트리
 * - 다중 전송 지원 (콘솔, 파일, 외부 서비스)
 * - 동적 전송 추가/제거
 * - 레벨별 필터링
 */

import type { LogLevel, LogEntry } from "../runtime/logger.js";

/**
 * 로그 전송 레코드 (Transport에 전달되는 데이터)
 */
export interface LogTransportRecord {
  /** 타임스탬프 (ISO 문자열) */
  timestamp: string;
  /** 로그 레벨 */
  level: LogLevel;
  /** 요청 ID */
  requestId?: string;
  /** HTTP 메서드 */
  method?: string;
  /** 요청 경로 */
  path?: string;
  /** HTTP 상태 코드 */
  status?: number;
  /** 응답 시간 (ms) */
  duration?: number;
  /** 에러 정보 */
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  /** 커스텀 메타데이터 */
  meta?: Record<string, unknown>;
  /** 느린 요청 여부 */
  slow?: boolean;
  /** 원본 LogEntry (필요시 접근) */
  raw?: LogEntry;
}

/**
 * 로그 전송 함수 타입
 */
export type LogTransport = (record: LogTransportRecord) => void | Promise<void>;

/**
 * 전송 등록 정보
 */
export interface TransportRegistration {
  /** 전송 ID */
  id: string;
  /** 전송 함수 */
  transport: LogTransport;
  /** 최소 로그 레벨 (이 레벨 이상만 전송) */
  minLevel?: LogLevel;
  /** 활성화 여부 */
  enabled: boolean;
}

/**
 * 로그 레벨 우선순위
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 전역 전송 레지스트리
 */
class TransportRegistry {
  private transports = new Map<string, TransportRegistration>();

  /**
   * 전송 추가
   *
   * @example
   * ```ts
   * attachLogTransport("file", async (record) => {
   *   await appendFile("app.log", JSON.stringify(record) + "\n");
   * });
   * ```
   */
  attach(
    id: string,
    transport: LogTransport,
    options: { minLevel?: LogLevel; enabled?: boolean } = {}
  ): void {
    this.transports.set(id, {
      id,
      transport,
      minLevel: options.minLevel,
      enabled: options.enabled ?? true,
    });
  }

  /**
   * 전송 제거
   */
  detach(id: string): boolean {
    return this.transports.delete(id);
  }

  /**
   * 전송 활성화/비활성화
   */
  setEnabled(id: string, enabled: boolean): void {
    const registration = this.transports.get(id);
    if (registration) {
      registration.enabled = enabled;
    }
  }

  /**
   * 모든 전송에 로그 전달
   */
  async dispatch(record: LogTransportRecord): Promise<void> {
    const recordLevel = LEVEL_PRIORITY[record.level];

    const promises: Promise<void>[] = [];

    for (const registration of this.transports.values()) {
      if (!registration.enabled) continue;

      // 레벨 필터링
      if (registration.minLevel) {
        const minLevel = LEVEL_PRIORITY[registration.minLevel];
        if (recordLevel < minLevel) continue;
      }

      try {
        const result = registration.transport(record);
        if (result instanceof Promise) {
          promises.push(result.catch((err) => {
            console.error(`[Log Transport] Error in ${registration.id}:`, err);
          }));
        }
      } catch (err) {
        console.error(`[Log Transport] Error in ${registration.id}:`, err);
      }
    }

    await Promise.all(promises);
  }

  /**
   * 동기적으로 모든 전송에 로그 전달 (비동기 전송은 fire-and-forget)
   */
  dispatchSync(record: LogTransportRecord): void {
    const recordLevel = LEVEL_PRIORITY[record.level];

    for (const registration of this.transports.values()) {
      if (!registration.enabled) continue;

      if (registration.minLevel) {
        const minLevel = LEVEL_PRIORITY[registration.minLevel];
        if (recordLevel < minLevel) continue;
      }

      try {
        const result = registration.transport(record);
        if (result instanceof Promise) {
          // 비동기 결과는 무시 (fire-and-forget)
          result.catch((err) => {
            console.error(`[Log Transport] Error in ${registration.id}:`, err);
          });
        }
      } catch (err) {
        console.error(`[Log Transport] Error in ${registration.id}:`, err);
      }
    }
  }

  /**
   * 등록된 전송 목록
   */
  list(): TransportRegistration[] {
    return Array.from(this.transports.values());
  }

  /**
   * 전송 존재 여부
   */
  has(id: string): boolean {
    return this.transports.has(id);
  }

  /**
   * 모든 전송 제거
   */
  clear(): void {
    this.transports.clear();
  }

  /**
   * 전송 개수
   */
  get size(): number {
    return this.transports.size;
  }
}

/**
 * 전역 전송 레지스트리 인스턴스
 */
export const transportRegistry = new TransportRegistry();

/**
 * 로그 전송 추가 (편의 함수)
 *
 * @example
 * ```ts
 * // 파일 전송
 * attachLogTransport("file", async (record) => {
 *   await fs.appendFile("app.log", JSON.stringify(record) + "\n");
 * }, { minLevel: "info" });
 *
 * // 외부 서비스 전송
 * attachLogTransport("datadog", async (record) => {
 *   await fetch("https://http-intake.logs.datadoghq.com/...", {
 *     method: "POST",
 *     body: JSON.stringify(record),
 *   });
 * }, { minLevel: "warn" });
 * ```
 */
export function attachLogTransport(
  id: string,
  transport: LogTransport,
  options?: { minLevel?: LogLevel; enabled?: boolean }
): void {
  transportRegistry.attach(id, transport, options);
}

/**
 * 로그 전송 제거 (편의 함수)
 */
export function detachLogTransport(id: string): boolean {
  return transportRegistry.detach(id);
}

/**
 * LogEntry를 LogTransportRecord로 변환
 */
export function entryToTransportRecord(entry: LogEntry): LogTransportRecord {
  return {
    timestamp: entry.timestamp,
    level: entry.level,
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    duration: entry.duration,
    error: entry.error ? {
      message: entry.error.message,
      stack: entry.error.stack,
    } : undefined,
    slow: entry.slow,
    raw: entry,
  };
}

// ============================================
// Built-in Transports
// ============================================

/**
 * 콘솔 전송 (기본)
 */
export function createConsoleTransport(options: {
  format?: "json" | "pretty";
} = {}): LogTransport {
  const { format = "pretty" } = options;

  return (record) => {
    const output = format === "json"
      ? JSON.stringify(record)
      : `[${record.timestamp}] ${record.level.toUpperCase()} ${record.method ?? ""} ${record.path ?? ""} ${record.status ?? ""} ${record.duration ? record.duration.toFixed(0) + "ms" : ""}`;

    switch (record.level) {
      case "error":
        console.error(output);
        break;
      case "warn":
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  };
}

/**
 * 메모리 버퍼 전송 (테스트용)
 */
export function createBufferTransport(buffer: LogTransportRecord[]): LogTransport {
  return (record) => {
    buffer.push(record);
  };
}

/**
 * 필터링 전송 래퍼
 */
export function createFilteredTransport(
  transport: LogTransport,
  filter: (record: LogTransportRecord) => boolean
): LogTransport {
  return (record) => {
    if (filter(record)) {
      return transport(record);
    }
  };
}

/**
 * 배치 전송 (성능 최적화)
 */
export function createBatchTransport(
  flush: (records: LogTransportRecord[]) => void | Promise<void>,
  options: {
    maxSize?: number;
    flushInterval?: number;
  } = {}
): { transport: LogTransport; flush: () => Promise<void>; stop: () => void } {
  const { maxSize = 100, flushInterval = 5000 } = options;

  const buffer: LogTransportRecord[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const doFlush = async () => {
    if (buffer.length === 0) return;
    const records = buffer.splice(0, buffer.length);
    await flush(records);
  };

  timer = setInterval(() => {
    doFlush().catch((err) => {
      console.error("[Batch Transport] Flush error:", err);
    });
  }, flushInterval);

  return {
    transport: (record) => {
      buffer.push(record);
      if (buffer.length >= maxSize) {
        doFlush().catch((err) => {
          console.error("[Batch Transport] Flush error:", err);
        });
      }
    },
    flush: doFlush,
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
