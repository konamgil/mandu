/**
 * MCP LogTransport Integration
 *
 * DNA-008 로깅 시스템과 MCP ActivityMonitor 통합
 */

import {
  attachLogTransport,
  detachLogTransport,
  type LogTransport,
  type LogTransportRecord,
} from "@mandujs/core";
import { monitorEventToRecord, type MonitorEvent } from "../adapters/monitor-adapter.js";

/**
 * MCP 로깅 Transport ID
 */
export const MCP_TRANSPORT_ID = "mcp-activity";

/**
 * MCP Activity Transport 옵션
 */
export interface McpTransportOptions {
  /** 로그 파일 경로 (선택) */
  logFile?: string;
  /** 콘솔 출력 여부 */
  consoleOutput?: boolean;
  /** 커스텀 핸들러 */
  onRecord?: (record: LogTransportRecord) => void;
}

/**
 * MCP Activity Transport 생성
 *
 * ActivityMonitor의 이벤트를 DNA-008 TransportRegistry로 전달
 */
export function createMcpActivityTransport(
  options: McpTransportOptions = {}
): LogTransport {
  const { consoleOutput = false, onRecord } = options;

  return (record: LogTransportRecord) => {
    // MCP 관련 로그만 처리
    const source = record.meta?.source;
    if (source !== "mcp" && source !== "tool" && source !== "watch") {
      return;
    }

    // 커스텀 핸들러
    if (onRecord) {
      onRecord(record);
    }

    // 콘솔 출력
    if (consoleOutput) {
      const prefix = `[MCP:${source}]`;
      const msg = record.error?.message || (record.meta?.message as string) || "";

      switch (record.level) {
        case "error":
          console.error(prefix, msg, record.meta);
          break;
        case "warn":
          console.warn(prefix, msg, record.meta);
          break;
        default:
          console.log(prefix, msg, record.meta);
      }
    }
  };
}

/**
 * MCP 로깅 설정
 *
 * @example
 * ```ts
 * setupMcpLogging({
 *   consoleOutput: true,
 *   onRecord: (record) => {
 *     // 커스텀 처리
 *   },
 * });
 * ```
 */
export function setupMcpLogging(options: McpTransportOptions = {}): void {
  const transport = createMcpActivityTransport(options);
  attachLogTransport(MCP_TRANSPORT_ID, transport, { minLevel: "info" });
}

/**
 * MCP 로깅 해제
 */
export function teardownMcpLogging(): void {
  detachLogTransport(MCP_TRANSPORT_ID);
}

/**
 * MonitorEvent를 DNA-008 시스템으로 전송
 *
 * ActivityMonitor에서 이 함수를 호출하여 로그 통합
 */
export function dispatchMonitorEvent(event: MonitorEvent): void {
  const record = monitorEventToRecord(event);

  // 직접 transport로 전달하지 않고,
  // 다른 transport들도 받을 수 있도록 registry를 통해 dispatch
  // (transportRegistry.dispatch는 core에서 export 필요)

  // 임시: 콘솔 출력
  if (event.severity === "error") {
    console.error(`[MCP:${event.source}] ${event.message || event.type}`, event.data);
  }
}

/**
 * MCP 로그 레코드 생성 헬퍼
 */
export function createMcpLogRecord(
  level: "debug" | "info" | "warn" | "error",
  source: "mcp" | "tool" | "watch",
  message: string,
  data?: Record<string, unknown>
): LogTransportRecord {
  return {
    timestamp: new Date().toISOString(),
    level,
    meta: {
      source,
      message,
      ...data,
    },
  };
}
