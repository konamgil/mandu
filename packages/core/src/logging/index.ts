/**
 * DNA-008: Structured Logging System
 *
 * 구조화된 로깅 시스템
 * - Transport 기반 다중 출력
 * - 동적 전송 추가/제거
 * - 레벨별 필터링
 */

export {
  transportRegistry,
  attachLogTransport,
  detachLogTransport,
  entryToTransportRecord,
  createConsoleTransport,
  createBufferTransport,
  createFilteredTransport,
  createBatchTransport,
  type LogTransport,
  type LogTransportRecord,
  type TransportRegistration,
} from "./transports.js";
