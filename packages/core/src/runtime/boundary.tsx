/**
 * Mandu Boundary Components
 *
 * Loading (Suspense) 및 Error (ErrorBoundary) UI 래퍼
 *
 * @module runtime/boundary
 */

import React, { Suspense, Component, type ReactNode, type ErrorInfo } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface LoadingBoundaryProps {
  /** 로딩 중 표시할 컴포넌트 */
  fallback: ReactNode;
  /** 자식 컴포넌트 */
  children: ReactNode;
}

export interface ErrorBoundaryProps {
  /** 에러 발생 시 표시할 컴포넌트 */
  fallback: React.ComponentType<ErrorFallbackProps>;
  /** 자식 컴포넌트 */
  children: ReactNode;
  /** 에러 발생 시 콜백 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface ErrorFallbackProps {
  /** 발생한 에러 */
  error: Error;
  /** 에러 정보 */
  errorInfo?: ErrorInfo;
  /** 리셋 함수 (에러 상태 초기화) */
  resetError: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Loading Boundary (Suspense Wrapper)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Loading Boundary - Suspense 래퍼
 *
 * @example
 * ```tsx
 * <LoadingBoundary fallback={<Loading />}>
 *   <AsyncComponent />
 * </LoadingBoundary>
 * ```
 */
export function LoadingBoundary({ fallback, children }: LoadingBoundaryProps): React.ReactElement {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Boundary (Class Component)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Error Boundary - 에러 캐치 및 fallback UI 표시
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={ErrorFallback}>
 *   <RiskyComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { fallback: Fallback, children } = this.props;

    if (hasError && error) {
      return (
        <Fallback
          error={error}
          errorInfo={errorInfo ?? undefined}
          resetError={this.resetError}
        />
      );
    }

    return children;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Fallback Components
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 기본 로딩 컴포넌트
 */
export function DefaultLoading(): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "2rem",
        color: "#666",
      }}
    >
      <div>Loading...</div>
    </div>
  );
}

/**
 * 기본 에러 컴포넌트
 */
export function DefaultError({ error, resetError }: ErrorFallbackProps): React.ReactElement {
  return (
    <div
      style={{
        padding: "2rem",
        backgroundColor: "#fff3f3",
        border: "1px solid #ffcccc",
        borderRadius: "8px",
        margin: "1rem",
      }}
    >
      <h2 style={{ color: "#cc0000", marginTop: 0 }}>Something went wrong</h2>
      <pre
        style={{
          backgroundColor: "#f5f5f5",
          padding: "1rem",
          borderRadius: "4px",
          overflow: "auto",
          fontSize: "0.875rem",
        }}
      >
        {error.message}
      </pre>
      <button
        onClick={resetError}
        style={{
          marginTop: "1rem",
          padding: "0.5rem 1rem",
          backgroundColor: "#cc0000",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Combined Boundary
// ═══════════════════════════════════════════════════════════════════════════

export interface PageBoundaryProps {
  /** 로딩 컴포넌트 (옵션) */
  loadingComponent?: ReactNode;
  /** 에러 컴포넌트 (옵션) */
  errorComponent?: React.ComponentType<ErrorFallbackProps>;
  /** 자식 컴포넌트 */
  children: ReactNode;
  /** 에러 발생 시 콜백 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

/**
 * Page Boundary - Loading + Error 래퍼
 *
 * @example
 * ```tsx
 * <PageBoundary
 *   loadingComponent={<CustomLoading />}
 *   errorComponent={CustomError}
 * >
 *   <PageContent />
 * </PageBoundary>
 * ```
 */
export function PageBoundary({
  loadingComponent,
  errorComponent,
  children,
  onError,
}: PageBoundaryProps): React.ReactElement {
  const LoadingFallback = loadingComponent ?? <DefaultLoading />;
  const ErrorFallback = errorComponent ?? DefaultError;

  return (
    <ErrorBoundary fallback={ErrorFallback} onError={onError}>
      <LoadingBoundary fallback={LoadingFallback}>{children}</LoadingBoundary>
    </ErrorBoundary>
  );
}
