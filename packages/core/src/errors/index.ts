/**
 * DNA-007: Error Utilities
 *
 * 에러 코드 추출 및 분류 유틸리티
 */

export {
  extractErrorCode,
  extractStatusCode,
  extractErrorMessage,
  extractErrorInfo,
  classifyError,
  formatUncaughtError,
  isErrorCategory,
  isRetryableError,
  serializeError,
  type ErrorCategory,
  type ExtractedErrorInfo,
} from "./extractor.js";
