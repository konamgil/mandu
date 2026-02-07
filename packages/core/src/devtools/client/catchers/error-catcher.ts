/**
 * Mandu Kitchen DevTools - Error Catcher
 * @version 1.0.3
 *
 * 전역 에러를 캐치하여 DevTools로 전달
 */

import type { NormalizedError, ErrorType, Severity } from '../../types';
import { getOrCreateHook } from '../../hook';
import { createErrorEvent } from '../../protocol';

// ============================================================================
// Types
// ============================================================================

interface ErrorCatcherOptions {
  /** 캐치할 에러 타입 */
  catchTypes?: {
    windowError?: boolean;
    unhandledRejection?: boolean;
    consoleError?: boolean;
    reactError?: boolean;
  };
  /** 무시할 에러 패턴 */
  ignorePatterns?: (string | RegExp)[];
  /** 에러 필터 함수 */
  filter?: (error: NormalizedError) => boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<ErrorCatcherOptions> = {
  catchTypes: {
    windowError: true,
    unhandledRejection: true,
    consoleError: false, // 기본 비활성화 (너무 많음)
    reactError: true,
  },
  ignorePatterns: [
    // Chrome extensions
    /^chrome-extension:\/\//,
    // React devtools
    /react-devtools/i,
    // Source map errors
    /\.map$/,
  ],
  filter: () => true,
};

// ============================================================================
// Error Normalizer
// ============================================================================

let errorIdCounter = 0;

function generateErrorId(): string {
  return `err-${Date.now()}-${++errorIdCounter}`;
}

function normalizeError(
  error: Error | string | unknown,
  type: ErrorType,
  extra?: Partial<NormalizedError>
): NormalizedError {
  const isError = error instanceof Error;

  return {
    id: generateErrorId(),
    type,
    severity: determineSeverity(type, error),
    message: isError ? error.message : String(error),
    stack: isError ? error.stack : undefined,
    timestamp: Date.now(),
    url: typeof window !== 'undefined' ? window.location.href : '',
    ...extra,
  };
}

function determineSeverity(type: ErrorType, _error: unknown): Severity {
  switch (type) {
    case 'runtime':
    case 'unhandled':
    case 'react':
      return 'error';
    case 'network':
      return 'warning';
    case 'hmr':
      return 'warning';
    case 'guard':
      return 'warning';
    default:
      return 'error';
  }
}

// ============================================================================
// Error Catcher Class
// ============================================================================

export class ErrorCatcher {
  private options: Required<ErrorCatcherOptions>;
  private isAttached = false;
  private handlers: {
    windowError?: (event: ErrorEvent) => void;
    unhandledRejection?: (event: PromiseRejectionEvent) => void;
    consoleError?: (...args: unknown[]) => void;
  } = {};
  private originalConsoleError?: typeof console.error;

  constructor(options?: ErrorCatcherOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      catchTypes: {
        ...DEFAULT_OPTIONS.catchTypes,
        ...options?.catchTypes,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  attach(): void {
    if (this.isAttached || typeof window === 'undefined') return;

    const { catchTypes } = this.options;

    if (catchTypes.windowError) {
      this.attachWindowError();
    }

    if (catchTypes.unhandledRejection) {
      this.attachUnhandledRejection();
    }

    if (catchTypes.consoleError) {
      this.attachConsoleError();
    }

    this.isAttached = true;
  }

  detach(): void {
    if (!this.isAttached || typeof window === 'undefined') return;

    if (this.handlers.windowError) {
      window.removeEventListener('error', this.handlers.windowError);
    }

    if (this.handlers.unhandledRejection) {
      window.removeEventListener(
        'unhandledrejection',
        this.handlers.unhandledRejection
      );
    }

    if (this.originalConsoleError) {
      console.error = this.originalConsoleError;
    }

    this.handlers = {};
    this.isAttached = false;
  }

  // --------------------------------------------------------------------------
  // Attach Handlers
  // --------------------------------------------------------------------------

  private attachWindowError(): void {
    this.handlers.windowError = (event: ErrorEvent) => {
      const error = normalizeError(event.error ?? event.message, 'runtime', {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });

      this.reportError(error);
    };

    window.addEventListener('error', this.handlers.windowError);
  }

  private attachUnhandledRejection(): void {
    this.handlers.unhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const error = normalizeError(reason, 'unhandled');

      this.reportError(error);
    };

    window.addEventListener('unhandledrejection', this.handlers.unhandledRejection);
  }

  private attachConsoleError(): void {
    this.originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      // 원래 console.error 호출
      this.originalConsoleError?.apply(console, args);

      // 에러로 변환
      const message = args
        .map((arg) =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        )
        .join(' ');

      const error = normalizeError(message, 'runtime', {
        severity: 'warning',
      });

      this.reportError(error);
    };
  }

  // --------------------------------------------------------------------------
  // Error Processing
  // --------------------------------------------------------------------------

  private shouldIgnore(error: NormalizedError): boolean {
    const { ignorePatterns, filter } = this.options;

    // 패턴 매칭
    for (const pattern of ignorePatterns) {
      if (typeof pattern === 'string') {
        if (error.message.includes(pattern) || error.url.includes(pattern)) {
          return true;
        }
      } else {
        if (
          pattern.test(error.message) ||
          pattern.test(error.url) ||
          (error.source && pattern.test(error.source))
        ) {
          return true;
        }
      }
    }

    // 필터 함수
    if (!filter(error)) {
      return true;
    }

    return false;
  }

  private reportError(error: NormalizedError): void {
    if (this.shouldIgnore(error)) return;

    const hook = getOrCreateHook();
    hook.emit(createErrorEvent(error));
  }

  // --------------------------------------------------------------------------
  // Manual Reporting
  // --------------------------------------------------------------------------

  /**
   * 수동으로 에러 리포트
   */
  report(
    error: Error | string,
    options?: Partial<Omit<NormalizedError, 'id' | 'timestamp' | 'message'>>
  ): void {
    const normalized = normalizeError(error, options?.type ?? 'runtime', options);
    this.reportError(normalized);
  }

  /**
   * React Error Boundary에서 호출
   */
  reportReactError(
    error: Error,
    errorInfo: { componentStack?: string }
  ): void {
    const normalized = normalizeError(error, 'react', {
      componentStack: errorInfo.componentStack,
    });
    this.reportError(normalized);
  }

  /**
   * Network 에러 리포트
   */
  reportNetworkError(
    url: string,
    status: number,
    message: string
  ): void {
    const normalized = normalizeError(message, 'network', {
      source: url,
      severity: status >= 500 ? 'error' : 'warning',
    });
    this.reportError(normalized);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalErrorCatcher: ErrorCatcher | null = null;

export function getErrorCatcher(options?: ErrorCatcherOptions): ErrorCatcher {
  if (!globalErrorCatcher) {
    globalErrorCatcher = new ErrorCatcher(options);
  }
  return globalErrorCatcher;
}

export function initializeErrorCatcher(options?: ErrorCatcherOptions): ErrorCatcher {
  const catcher = getErrorCatcher(options);
  catcher.attach();
  return catcher;
}

export function destroyErrorCatcher(): void {
  if (globalErrorCatcher) {
    globalErrorCatcher.detach();
    globalErrorCatcher = null;
  }
}
