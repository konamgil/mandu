/**
 * Mandu Kitchen DevTools - AI Context Builder
 * @version 1.1.0
 *
 * AI 분석을 위한 컨텍스트 페이로드 생성
 * - 에러 정보 정규화
 * - 코드 컨텍스트 수집
 * - 인과관계 체인 구성
 */

import type {
  NormalizedError,
  IslandSnapshot,
  AIContextPayload,
  CodeContextInfo,
  DevToolsConfig,
} from '../types';
import { DEVTOOLS_VERSION } from '../protocol';

// ============================================================================
// Types
// ============================================================================

export interface ContextBuilderOptions {
  /** DevTools 설정 */
  config?: DevToolsConfig;
  /** 최근 에러 최대 개수 */
  maxRecentErrors?: number;
  /** 사용자 액션 최대 개수 */
  maxUserActions?: number;
  /** Framework 버전 */
  frameworkVersion?: string;
  /** Source Context API URL */
  sourceContextUrl?: string;
}

export interface UserAction {
  type: 'navigation' | 'interaction' | 'reload';
  targetHint?: string;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<Omit<ContextBuilderOptions, 'config'>> = {
  maxRecentErrors: 5,
  maxUserActions: 10,
  frameworkVersion: '1.0.0',
  sourceContextUrl: '/api/__mandu_source__',
};

// ============================================================================
// AI Context Builder
// ============================================================================

export class AIContextBuilder {
  private options: Required<Omit<ContextBuilderOptions, 'config'>> & {
    config?: DevToolsConfig;
  };
  private recentErrors: NormalizedError[] = [];
  private userActions: UserAction[] = [];
  private errorCausalityMap = new Map<string, string[]>();

  constructor(options: ContextBuilderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // --------------------------------------------------------------------------
  // Error Tracking
  // --------------------------------------------------------------------------

  /**
   * 에러 추가 (인과관계 분석용)
   */
  addError(error: NormalizedError): void {
    this.recentErrors.push(error);

    // 최대 개수 제한
    if (this.recentErrors.length > this.options.maxRecentErrors * 2) {
      this.recentErrors = this.recentErrors.slice(-this.options.maxRecentErrors);
    }

    // 인과관계 분석
    this.analyzeCausality(error);
  }

  /**
   * 에러 인과관계 분석
   */
  private analyzeCausality(newError: NormalizedError): void {
    // 최근 에러들과 비교하여 인과관계 파악
    const recentWindow = 5000; // 5초 이내
    const potentialCauses: string[] = [];

    for (const error of this.recentErrors) {
      if (error.id === newError.id) continue;

      // 시간적 연관성
      const timeDiff = newError.timestamp - error.timestamp;
      if (timeDiff <= 0 || timeDiff > recentWindow) continue;

      // 스택 트레이스 연관성
      if (
        newError.stack &&
        error.stack &&
        this.hasStackOverlap(newError.stack, error.stack)
      ) {
        potentialCauses.push(error.id);
        continue;
      }

      // 같은 컴포넌트/Island에서 발생
      if (newError.islandId && newError.islandId === error.islandId) {
        potentialCauses.push(error.id);
        continue;
      }

      // 같은 파일에서 발생
      if (newError.source && newError.source === error.source) {
        potentialCauses.push(error.id);
      }
    }

    if (potentialCauses.length > 0) {
      this.errorCausalityMap.set(newError.id, potentialCauses);
    }
  }

  /**
   * 스택 트레이스 겹침 확인
   */
  private hasStackOverlap(stack1: string, stack2: string): boolean {
    const frames1 = this.extractStackFrames(stack1);
    const frames2 = this.extractStackFrames(stack2);

    for (const frame of frames1) {
      if (frames2.includes(frame)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 스택 프레임 추출
   */
  private extractStackFrames(stack: string): string[] {
    const frameRegex = /at\s+(?:.*\s+\()?([^)]+:\d+:\d+)/g;
    const frames: string[] = [];
    let match;

    while ((match = frameRegex.exec(stack)) !== null) {
      frames.push(match[1]);
    }

    return frames;
  }

  // --------------------------------------------------------------------------
  // User Action Tracking
  // --------------------------------------------------------------------------

  /**
   * 사용자 액션 추가
   */
  addUserAction(action: UserAction): void {
    this.userActions.push(action);

    if (this.userActions.length > this.options.maxUserActions) {
      this.userActions = this.userActions.slice(-this.options.maxUserActions);
    }
  }

  /**
   * 내비게이션 추적
   */
  trackNavigation(url: string): void {
    this.addUserAction({
      type: 'navigation',
      targetHint: url,
      timestamp: Date.now(),
    });
  }

  /**
   * 인터랙션 추적 (클릭, 입력 등)
   */
  trackInteraction(targetHint?: string): void {
    this.addUserAction({
      type: 'interaction',
      targetHint,
      timestamp: Date.now(),
    });
  }

  /**
   * 페이지 리로드 추적
   */
  trackReload(): void {
    this.addUserAction({
      type: 'reload',
      timestamp: Date.now(),
    });
  }

  // --------------------------------------------------------------------------
  // Context Building
  // --------------------------------------------------------------------------

  /**
   * AI Context Payload 생성
   */
  async buildContext(
    error: NormalizedError,
    island?: IslandSnapshot
  ): Promise<AIContextPayload> {
    // 기본 페이로드
    const payload: AIContextPayload = {
      error,
      island,
      framework: {
        name: 'mandu',
        version: this.options.frameworkVersion,
      },
      devtools: {
        version: DEVTOOLS_VERSION,
      },
    };

    // 최근 에러 (인과관계 포함)
    if (this.recentErrors.length > 0) {
      payload.recentErrors = this.recentErrors
        .slice(-this.options.maxRecentErrors)
        .filter((e) => e.id !== error.id)
        .map((e) => ({
          id: e.id,
          message: e.message,
          timestamp: e.timestamp,
          isCausedBy: this.errorCausalityMap.get(e.id)?.[0],
        }));
    }

    // 사용자 액션
    if (
      this.options.config?.dataSafety?.collectUserActions !== false &&
      this.userActions.length > 0
    ) {
      payload.userActions = this.userActions.slice(-this.options.maxUserActions);
    }

    // 코드 컨텍스트 (Source Context Provider 사용)
    if (this.options.config?.dataSafety?.collectCodeContext !== false) {
      const codeContext = await this.fetchCodeContext(error);
      if (codeContext) {
        payload.codeContext = codeContext;
      }
    }

    return payload;
  }

  /**
   * Source Context 가져오기
   */
  private async fetchCodeContext(
    error: NormalizedError
  ): Promise<CodeContextInfo | undefined> {
    if (!error.source || !error.line) {
      return undefined;
    }

    const codeContext: CodeContextInfo = {
      filePath: error.source,
      line: error.line,
      column: error.column,
    };

    // Dev Server에서 소스 코드 가져오기 시도
    try {
      const url = new URL(this.options.sourceContextUrl, window.location.origin);
      url.searchParams.set('file', error.source);
      url.searchParams.set('line', String(error.line));
      url.searchParams.set('context', '5');

      const response = await fetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          codeContext.snippet = {
            content: data.data.content,
            lineRange: data.data.lineRange,
            source: 'dev-server',
          };
        }
      }
    } catch {
      // 실패해도 기본 컨텍스트 정보는 반환
    }

    return codeContext;
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /**
   * 에러 목록 초기화
   */
  clearErrors(): void {
    this.recentErrors = [];
    this.errorCausalityMap.clear();
  }

  /**
   * 사용자 액션 초기화
   */
  clearUserActions(): void {
    this.userActions = [];
  }

  /**
   * 전체 초기화
   */
  clear(): void {
    this.clearErrors();
    this.clearUserActions();
  }

  /**
   * 인과관계 체인 가져오기
   */
  getCausalityChain(errorId: string): string[] {
    const chain: string[] = [];
    let currentId: string | undefined = errorId;

    while (currentId) {
      const causes = this.errorCausalityMap.get(currentId);
      if (!causes || causes.length === 0) break;

      const cause = causes[0];
      if (chain.includes(cause)) break; // 순환 방지

      chain.push(cause);
      currentId = cause;
    }

    return chain;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalContextBuilder: AIContextBuilder | null = null;

export function getContextBuilder(
  options?: ContextBuilderOptions
): AIContextBuilder {
  if (!globalContextBuilder) {
    globalContextBuilder = new AIContextBuilder(options);
  }
  return globalContextBuilder;
}

export function resetContextBuilder(): void {
  if (globalContextBuilder) {
    globalContextBuilder.clear();
  }
  globalContextBuilder = null;
}
