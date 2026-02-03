/**
 * Mandu Kitchen DevTools - MCP Connector
 * @version 1.1.0
 *
 * Model Context Protocol (MCP) 연동
 * - AI 에이전트와의 통신
 * - 컨텍스트 전달
 * - 수정 제안 수신
 */

import type { AIContextPayload, NormalizedError } from '../types';
import { AIContextBuilder, getContextBuilder } from './context-builder';

// ============================================================================
// Types
// ============================================================================

export interface MCPConnectorOptions {
  /** MCP 서버 URL */
  serverUrl?: string;
  /** 연결 타임아웃 (ms) */
  connectionTimeout?: number;
  /** 요청 타임아웃 (ms) */
  requestTimeout?: number;
  /** 자동 재연결 */
  autoReconnect?: boolean;
  /** 재연결 간격 (ms) */
  reconnectInterval?: number;
  /** 최대 재연결 시도 횟수 */
  maxReconnectAttempts?: number;
}

export interface MCPMessage {
  id: string;
  type: 'request' | 'response' | 'notification';
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface AnalysisRequest {
  context: AIContextPayload;
  options?: {
    includeFixSuggestion?: boolean;
    includeExplanation?: boolean;
    language?: string;
  };
}

export interface AnalysisResponse {
  success: boolean;
  analysis?: {
    rootCause: string;
    explanation: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: string;
  };
  fixSuggestion?: {
    description: string;
    code?: string;
    file?: string;
    lineRange?: [number, number];
    confidence: number;
  };
  relatedDocs?: Array<{
    title: string;
    url: string;
  }>;
  error?: string;
}

export type MCPConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<MCPConnectorOptions> = {
  serverUrl: 'ws://localhost:3333/mcp',
  connectionTimeout: 5000,
  requestTimeout: 30000,
  autoReconnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 5,
};

// ============================================================================
// MCP Connector
// ============================================================================

export class MCPConnector {
  private options: Required<MCPConnectorOptions>;
  private ws: WebSocket | null = null;
  private status: MCPConnectionStatus = 'disconnected';
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<(status: MCPConnectionStatus) => void>();
  private contextBuilder: AIContextBuilder;

  constructor(options: MCPConnectorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.contextBuilder = getContextBuilder();
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  /**
   * MCP 서버에 연결
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === 'connected' && this.ws) {
        resolve();
        return;
      }

      this.setStatus('connecting');

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.handleConnectionError(new Error('Connection timeout'));
      }, this.options.connectionTimeout);

      try {
        this.ws = new WebSocket(this.options.serverUrl);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.setStatus('connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onclose = () => {
          this.handleDisconnect();
        };

        this.ws.onerror = (event) => {
          clearTimeout(timeout);
          this.handleConnectionError(new Error('WebSocket error'));
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        clearTimeout(timeout);
        this.handleConnectionError(
          error instanceof Error ? error : new Error(String(error))
        );
        reject(error);
      }
    });
  }

  /**
   * 연결 종료
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // 대기 중인 요청 모두 reject
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    this.setStatus('disconnected');
  }

  /**
   * 연결 상태 조회
   */
  getStatus(): MCPConnectionStatus {
    return this.status;
  }

  /**
   * 상태 변경 리스너 등록
   */
  onStatusChange(
    listener: (status: MCPConnectionStatus) => void
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // --------------------------------------------------------------------------
  // MCP Methods
  // --------------------------------------------------------------------------

  /**
   * 에러 분석 요청
   */
  async analyzeError(
    error: NormalizedError,
    options?: AnalysisRequest['options']
  ): Promise<AnalysisResponse> {
    // 컨텍스트 빌드
    const context = await this.contextBuilder.buildContext(error);

    return this.sendRequest<AnalysisResponse>('mandu/analyze', {
      context,
      options: {
        includeFixSuggestion: true,
        includeExplanation: true,
        language: 'ko',
        ...options,
      },
    });
  }

  /**
   * 수정 제안 요청
   */
  async getSuggestion(
    error: NormalizedError,
    codeContext: string
  ): Promise<AnalysisResponse['fixSuggestion']> {
    const result = await this.sendRequest<{
      suggestion: AnalysisResponse['fixSuggestion'];
    }>('mandu/suggest', {
      error: {
        message: error.message,
        type: error.type,
        source: error.source,
        line: error.line,
      },
      codeContext,
    });

    return result.suggestion;
  }

  /**
   * 관련 문서 검색
   */
  async searchDocs(
    query: string
  ): Promise<AnalysisResponse['relatedDocs']> {
    const result = await this.sendRequest<{
      docs: AnalysisResponse['relatedDocs'];
    }>('mandu/docs', { query });

    return result.docs;
  }

  /**
   * 클립보드용 컨텍스트 생성
   * (AI 에이전트에 붙여넣기 위한 포맷)
   */
  async formatForClipboard(error: NormalizedError): Promise<string> {
    const context = await this.contextBuilder.buildContext(error);

    const parts: string[] = [
      '## Error Report',
      '',
      `**Type**: ${error.type}`,
      `**Severity**: ${error.severity}`,
      `**Message**: ${error.message}`,
      '',
    ];

    if (error.source) {
      parts.push(`**Location**: ${error.source}:${error.line ?? '?'}:${error.column ?? '?'}`);
      parts.push('');
    }

    if (error.stack) {
      parts.push('### Stack Trace');
      parts.push('```');
      parts.push(error.stack);
      parts.push('```');
      parts.push('');
    }

    if (context.codeContext?.snippet) {
      parts.push('### Source Code');
      parts.push('```typescript');
      parts.push(context.codeContext.snippet.content);
      parts.push('```');
      parts.push('');
    }

    if (context.island) {
      parts.push('### Island Info');
      parts.push(`- Name: ${context.island.name}`);
      parts.push(`- Status: ${context.island.status}`);
      parts.push(`- Strategy: ${context.island.strategy}`);
      parts.push('');
    }

    if (context.recentErrors && context.recentErrors.length > 0) {
      parts.push('### Recent Related Errors');
      for (const e of context.recentErrors) {
        const timeAgo = Math.round((Date.now() - e.timestamp) / 1000);
        parts.push(`- ${e.message} (${timeAgo}s ago)`);
      }
      parts.push('');
    }

    parts.push('---');
    parts.push(`*Generated by Mandu Kitchen DevTools v${context.devtools.version}*`);

    return parts.join('\n');
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private setStatus(status: MCPConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      for (const listener of this.statusListeners) {
        try {
          listener(status);
        } catch {
          // 리스너 에러 무시
        }
      }
    }
  }

  private handleMessage(data: string): void {
    try {
      const message: MCPMessage = JSON.parse(data);

      if (message.type === 'response' && message.id) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      }
    } catch (error) {
      console.warn('[Mandu Kitchen] Failed to parse MCP message:', error);
    }
  }

  private handleDisconnect(): void {
    this.ws = null;

    if (this.options.autoReconnect && this.status !== 'disconnected') {
      this.setStatus('error');
      this.scheduleReconnect();
    } else {
      this.setStatus('disconnected');
    }
  }

  private handleConnectionError(error: Error): void {
    console.warn('[Mandu Kitchen] MCP connection error:', error.message);
    this.setStatus('error');

    if (this.options.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.warn('[Mandu Kitchen] Max reconnection attempts reached');
      this.setStatus('disconnected');
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[Mandu Kitchen] Reconnecting in ${this.options.reconnectInterval}ms (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // 에러는 handleConnectionError에서 처리됨
      });
    }, this.options.reconnectInterval);
  }

  private async sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('Not connected to MCP server');
    }

    const id = `req-${++this.requestIdCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.options.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      const message: MCPMessage = {
        id,
        type: 'request',
        method,
        params,
      };

      this.ws!.send(JSON.stringify(message));
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalMCPConnector: MCPConnector | null = null;

export function getMCPConnector(options?: MCPConnectorOptions): MCPConnector {
  if (!globalMCPConnector) {
    globalMCPConnector = new MCPConnector(options);
  }
  return globalMCPConnector;
}

export function destroyMCPConnector(): void {
  if (globalMCPConnector) {
    globalMCPConnector.disconnect();
    globalMCPConnector = null;
  }
}
