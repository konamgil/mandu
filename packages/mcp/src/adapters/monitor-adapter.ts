/**
 * Monitor Event Adapter
 *
 * ActivityMonitor 이벤트와 DNA-008 LogTransportRecord 간 변환
 */

import type { LogTransportRecord } from "@mandujs/core";

/**
 * Monitor 이벤트 타입 (ActivityMonitor에서 사용)
 */
export interface MonitorEvent {
  ts: string;
  type: string;
  severity: MonitorSeverity;
  source: string;
  message?: string;
  data?: Record<string, unknown>;
  actionRequired?: boolean;
  fingerprint?: string;
  count?: number;
  schemaVersion?: string;
}

export type MonitorSeverity = "info" | "warn" | "error";
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * MonitorSeverity → LogLevel 변환
 */
export function severityToLevel(severity: MonitorSeverity): LogLevel {
  switch (severity) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "info":
    default:
      return "info";
  }
}

/**
 * LogLevel → MonitorSeverity 변환
 */
export function levelToSeverity(level: LogLevel): MonitorSeverity {
  switch (level) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "debug":
    case "info":
    default:
      return "info";
  }
}

/**
 * MonitorEvent → LogTransportRecord 변환
 *
 * ActivityMonitor 이벤트를 DNA-008 로깅 시스템으로 전송할 때 사용
 */
export function monitorEventToRecord(event: MonitorEvent): LogTransportRecord {
  return {
    timestamp: event.ts,
    level: severityToLevel(event.severity),
    meta: {
      type: event.type,
      source: event.source,
      fingerprint: event.fingerprint,
      count: event.count,
      actionRequired: event.actionRequired,
      schemaVersion: event.schemaVersion,
      ...event.data,
    },
  };
}

/**
 * LogTransportRecord → MonitorEvent 변환 (역방향)
 *
 * DNA-008 로그를 ActivityMonitor에서 표시할 때 사용
 */
export function recordToMonitorEvent(record: LogTransportRecord): MonitorEvent {
  const meta = record.meta ?? {};

  return {
    ts: record.timestamp,
    type: (meta.type as string) ?? "log",
    severity: levelToSeverity(record.level),
    source: (meta.source as string) ?? "unknown",
    message: record.error?.message,
    data: meta,
    actionRequired: (meta.actionRequired as boolean) ?? false,
    fingerprint: meta.fingerprint as string | undefined,
    count: meta.count as number | undefined,
    schemaVersion: meta.schemaVersion as string | undefined,
  };
}
