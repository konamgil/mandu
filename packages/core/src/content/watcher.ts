/**
 * Content Watcher - 개발 모드 파일 감시
 *
 * 콘텐츠 파일 변경 시 자동 리로드
 */

import type { ContentWatcher } from "./types";
import chokidar, { type FSWatcher } from "chokidar";

/**
 * ContentWatcher 옵션
 */
export interface ContentWatcherOptions {
  /** 루트 디렉토리 */
  root: string;
  /** 무시할 패턴 */
  ignored?: string[];
  /** 디바운스 (ms) */
  debounce?: number;
}

/**
 * ContentWatcher 구현
 */
class ContentWatcherImpl implements ContentWatcher {
  private watcher: FSWatcher;
  private handlers: Map<string, Set<(path: string) => void>> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number;

  constructor(options: ContentWatcherOptions) {
    const { root, ignored = ["**/node_modules/**", "**/.git/**"], debounce = 300 } = options;

    this.debounceMs = debounce;

    this.watcher = chokidar.watch([], {
      cwd: root,
      ignored,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: debounce,
        pollInterval: 100,
      },
    });

    // 이벤트 핸들러 연결
    this.watcher.on("change", (path) => this.emit("change", path));
    this.watcher.on("add", (path) => this.emit("add", path));
    this.watcher.on("unlink", (path) => this.emit("unlink", path));
  }

  /**
   * 파일/패턴 감시 추가
   */
  add(paths: string | string[]): void {
    this.watcher.add(paths);
  }

  /**
   * 파일/패턴 감시 제거
   */
  remove(paths: string | string[]): void {
    this.watcher.unwatch(paths);
  }

  /**
   * 이벤트 핸들러 등록
   */
  on(event: "change" | "add" | "unlink", handler: (path: string) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * 이벤트 핸들러 제거
   */
  off(event: "change" | "add" | "unlink", handler: (path: string) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * 감시 종료
   */
  async close(): Promise<void> {
    // 모든 디바운스 타이머 정리
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.watcher.close();
  }

  /**
   * 이벤트 발생 (디바운스 적용)
   */
  private emit(event: "change" | "add" | "unlink", path: string): void {
    const key = `${event}:${path}`;

    // 기존 타이머 취소
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key)!);
    }

    // 디바운스 적용
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);

      const handlers = this.handlers.get(event);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(path);
          } catch (error) {
            console.error(
              `[ContentWatcher] Handler error for ${event}:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      }
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }
}

/**
 * ContentWatcher 팩토리
 */
export function createContentWatcher(options: ContentWatcherOptions): ContentWatcher {
  return new ContentWatcherImpl(options);
}
