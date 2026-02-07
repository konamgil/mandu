/**
 * Mandu Kitchen DevTools - Worker Manager
 * @version 1.1.0
 *
 * Worker 생명주기 관리, Fallback 정책, 타임아웃 처리
 */

import type { WorkerPolicy, RedactPattern } from '../types';
import type { WorkerRequest, WorkerResponse } from './redaction-worker';
import { redactText, truncateText } from './redaction-worker';

// ============================================================================
// Types
// ============================================================================

export type WorkerStatus = 'idle' | 'loading' | 'ready' | 'error' | 'disabled';

export interface WorkerManagerOptions {
  /** Worker 정책 */
  policy?: Partial<WorkerPolicy>;
  /** Worker 스크립트 URL (기본: 인라인) */
  workerUrl?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_POLICY: WorkerPolicy = {
  timeout: 3000,
  onTimeout: 'fallback-main',
  onError: 'retry-once',
  maxConsecutiveFailures: 3,
};

// ============================================================================
// Worker Manager
// ============================================================================

export class WorkerManager {
  private worker: Worker | null = null;
  private status: WorkerStatus = 'idle';
  private policy: WorkerPolicy;
  private pendingRequests = new Map<string, {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private requestIdCounter = 0;
  private consecutiveFailures = 0;
  private workerUrl?: string;
  private listeners: Set<(status: WorkerStatus) => void> = new Set();

  constructor(options: WorkerManagerOptions = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.workerUrl = options.workerUrl;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Worker 초기화
   */
  async initialize(): Promise<boolean> {
    if (this.status === 'disabled') {
      return false;
    }

    if (this.status === 'ready' && this.worker) {
      return true;
    }

    this.setStatus('loading');

    try {
      // Worker 생성
      if (this.workerUrl) {
        this.worker = new Worker(this.workerUrl, { type: 'module' });
      } else {
        // 인라인 Worker (번들링된 코드 사용)
        this.worker = this.createInlineWorker();
      }

      if (!this.worker) {
        throw new Error('Worker creation failed');
      }

      // 메시지 핸들러 설정
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      // Ping 테스트
      const pingResult = await this.sendRequest({ type: 'ping', data: {} });
      if (!pingResult.success) {
        throw new Error('Worker ping failed');
      }

      this.setStatus('ready');
      this.consecutiveFailures = 0;
      return true;
    } catch (error) {
      console.warn('[Mandu Kitchen] Worker initialization failed:', error);
      this.handleFailure();
      return false;
    }
  }

  /**
   * Worker 종료
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // 대기 중인 요청 모두 reject
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Worker terminated'));
    }
    this.pendingRequests.clear();

    this.setStatus('idle');
  }

  /**
   * Worker 비활성화 (복구 불가)
   */
  disable(): void {
    this.terminate();
    this.setStatus('disabled');
    console.warn('[Mandu Kitchen] Worker disabled due to consecutive failures');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * 텍스트 리댁션 (Worker 또는 Fallback)
   */
  async redact(text: string, patterns?: RedactPattern[]): Promise<string> {
    // Worker 사용 불가면 메인 스레드에서 처리
    if (!this.isAvailable()) {
      return this.fallbackRedact(text, patterns);
    }

    try {
      const response = await this.sendRequest({
        type: 'redact',
        data: { text, patterns },
      });

      if (response.success && response.result !== undefined) {
        this.consecutiveFailures = 0;
        return response.result;
      }

      throw new Error(response.error ?? 'Redaction failed');
    } catch (error) {
      return this.handleRequestError(error, () => this.fallbackRedact(text, patterns));
    }
  }

  /**
   * 텍스트 Truncation (Worker 또는 Fallback)
   */
  async truncate(text: string, maxBytes: number): Promise<string> {
    if (!this.isAvailable()) {
      return this.fallbackTruncate(text, maxBytes);
    }

    try {
      const response = await this.sendRequest({
        type: 'truncate',
        data: { text, maxBytes },
      });

      if (response.success && response.result !== undefined) {
        this.consecutiveFailures = 0;
        return response.result;
      }

      throw new Error(response.error ?? 'Truncation failed');
    } catch (error) {
      return this.handleRequestError(error, () => this.fallbackTruncate(text, maxBytes));
    }
  }

  /**
   * Worker 상태 조회
   */
  getStatus(): WorkerStatus {
    return this.status;
  }

  /**
   * Worker 사용 가능 여부
   */
  isAvailable(): boolean {
    return this.status === 'ready' && this.worker !== null;
  }

  /**
   * 상태 변경 리스너 등록
   */
  onStatusChange(listener: (status: WorkerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private setStatus(status: WorkerStatus): void {
    if (this.status !== status) {
      this.status = status;
      for (const listener of this.listeners) {
        try {
          listener(status);
        } catch {
          // 리스너 에러 무시
        }
      }
    }
  }

  private createInlineWorker(): Worker | null {
    // 인라인 Worker 생성을 위한 코드
    // 실제 프로덕션에서는 번들된 Worker 파일을 사용하는 것이 좋음
    const workerCode = `
      const BUILT_IN_SECRET_PATTERNS = [
        { source: 'eyJ[A-Za-z0-9_-]{10,}\\\\.[A-Za-z0-9_-]{10,}\\\\.[A-Za-z0-9_-]{10,}', label: 'JWT' },
        { source: 'AKIA[0-9A-Z]{16}', label: 'AWS_KEY' },
        { source: '(?:api[_-]?key|apikey)["\\']?\\\\s*[:=]\\\\s*["\\']?[A-Za-z0-9_-]{20,}', flags: 'i', label: 'API_KEY' },
        { source: 'Bearer\\\\s+[A-Za-z0-9_-]{20,}', label: 'BEARER' },
        { source: '(?:secret|password|passwd|pwd)["\\']?\\\\s*[:=]\\\\s*["\\']?[^\\\\s"\\'\\']{8,}', flags: 'i', label: 'SECRET' },
      ];

      const PII_PATTERNS = [
        { source: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}', label: 'EMAIL' },
        { source: '\\\\+?[1-9]\\\\d{1,14}', label: 'PHONE' },
        { source: '\\\\b(?:\\\\d{1,3}\\\\.){3}\\\\d{1,3}\\\\b', label: 'IP' },
      ];

      function applyPattern(text, pattern) {
        try {
          const regex = new RegExp(pattern.source, pattern.flags ?? 'g');
          const replacement = pattern.replacement ?? '[' + (pattern.label ?? 'REDACTED') + ']';
          return text.replace(regex, replacement);
        } catch {
          return text;
        }
      }

      function redactText(text, patterns = []) {
        let result = text;
        for (const p of BUILT_IN_SECRET_PATTERNS) result = applyPattern(result, p);
        for (const p of PII_PATTERNS) result = applyPattern(result, p);
        for (const p of patterns) result = applyPattern(result, p);
        return result;
      }

      function truncateText(text, maxBytes) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(text);
        if (bytes.length <= maxBytes) return text;
        let truncatedBytes = bytes.slice(0, maxBytes - 3);
        while (truncatedBytes.length > 0 && (truncatedBytes[truncatedBytes.length - 1] & 0xc0) === 0x80) {
          truncatedBytes = truncatedBytes.slice(0, -1);
        }
        return new TextDecoder().decode(truncatedBytes) + '...';
      }

      self.onmessage = (event) => {
        const { id, type, data } = event.data;
        const start = performance.now();
        try {
          let result;
          if (type === 'ping') result = 'pong';
          else if (type === 'redact') result = redactText(data.text ?? '', data.patterns ?? []);
          else if (type === 'truncate') result = truncateText(data.text ?? '', data.maxBytes ?? 10000);
          else throw new Error('Unknown type: ' + type);
          self.postMessage({ id, success: true, result, timing: performance.now() - start });
        } catch (e) {
          self.postMessage({ id, success: false, error: e.message });
        }
      };
    `;

    try {
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);

      // URL 정리
      URL.revokeObjectURL(url);

      return worker;
    } catch {
      return null;
    }
  }

  private async sendRequest(
    request: Omit<WorkerRequest, 'id'>
  ): Promise<WorkerResponse> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const id = `req-${++this.requestIdCounter}`;

    return new Promise<WorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Worker request timeout'));
      }, this.policy.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.worker!.postMessage({ id, ...request });
    });
  }

  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;
    const pending = this.pendingRequests.get(response.id);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  private handleWorkerError(event: ErrorEvent): void {
    console.error('[Mandu Kitchen] Worker error:', event.message);
    this.handleFailure();
  }

  private handleFailure(): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.policy.maxConsecutiveFailures) {
      this.disable();
    } else {
      this.setStatus('error');
    }
  }

  private handleRequestError<T>(error: unknown, fallback: () => T): T {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.policy.maxConsecutiveFailures) {
      this.disable();
    }

    if (this.policy.onTimeout === 'fallback-main') {
      return fallback();
    }

    throw error;
  }

  // --------------------------------------------------------------------------
  // Fallback (Main Thread)
  // --------------------------------------------------------------------------

  private fallbackRedact(text: string, patterns?: RedactPattern[]): string {
    return redactText(text, patterns);
  }

  private fallbackTruncate(text: string, maxBytes: number): string {
    return truncateText(text, maxBytes);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalWorkerManager: WorkerManager | null = null;

export function getWorkerManager(options?: WorkerManagerOptions): WorkerManager {
  if (!globalWorkerManager) {
    globalWorkerManager = new WorkerManager(options);
  }
  return globalWorkerManager;
}

export async function initializeWorkerManager(
  options?: WorkerManagerOptions
): Promise<WorkerManager> {
  const manager = getWorkerManager(options);
  await manager.initialize();
  return manager;
}

export function destroyWorkerManager(): void {
  if (globalWorkerManager) {
    globalWorkerManager.terminate();
    globalWorkerManager = null;
  }
}
