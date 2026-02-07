// Types
export type { ManduError, RouteContext, FixTarget, DebugInfo, ErrorType } from "./types";
export { ErrorCode, ERROR_MESSAGES, ERROR_SUMMARIES } from "./types";

// Domain Error Classes
export {
  ManduBaseError,
  FileError,
  DirectoryError,
  GuardError,
  RouterError,
  SSRError,
  ContractError,
  SecurityError,
} from "./domains";

// Stack Analyzer
export { StackTraceAnalyzer, type StackFrame } from "./stack-analyzer";

// Classifier
export {
  ErrorClassifier,
  createSpecError,
  createLogicError,
  createFrameworkBug,
} from "./classifier";

// Formatter
export {
  formatErrorResponse,
  formatErrorForConsole,
  createNotFoundResponse,
  createHandlerNotFoundResponse,
  createPageLoadErrorResponse,
  createSSRErrorResponse,
  type FormatOptions,
} from "./formatter";

// Result helpers
export type { Result } from "./result";
export { ok, err, statusFromError, errorToResponse } from "./result";
