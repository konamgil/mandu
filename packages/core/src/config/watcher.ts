/**
 * DNA-006: Config Hot Reload
 *
 * 설정 파일 변경 감시 및 핫 리로드
 * - 디바운스로 연속 변경 병합
 * - 에러 발생 시 기존 설정 유지
 * - 클린업 함수 반환
 */

import { watch, type FSWatcher } from "fs";
import { loadManduConfig, type ManduConfig } from "./mandu.js";

/**
 * 설정 변경 이벤트 타입
 */
export type ConfigChangeEvent = {
  /** 이전 설정 */
  previous: ManduConfig;
  /** 새 설정 */
  current: ManduConfig;
  /** 변경된 파일 경로 */
  path: string;
  /** 변경 시간 */
  timestamp: Date;
};

/**
 * 설정 감시 옵션
 */
export interface WatchConfigOptions {
  /** 디바운스 딜레이 (ms, 기본: 100) */
  debounceMs?: number;
  /** 초기 로드 시에도 콜백 호출 (기본: false) */
  immediate?: boolean;
  /** 에러 핸들러 */
  onError?: (error: Error) => void;
}

/**
 * 설정 변경 콜백
 */
export type ConfigChangeCallback = (
  newConfig: ManduConfig,
  event: ConfigChangeEvent
) => void;

/**
 * 설정 감시 결과
 */
export interface ConfigWatcher {
  /** 감시 중지 */
  stop: () => void;
  /** 현재 설정 */
  getConfig: () => ManduConfig;
  /** 수동 리로드 */
  reload: () => Promise<ManduConfig>;
}

/**
 * 설정 파일 감시 및 핫 리로드
 *
 * @example
 * ```ts
 * const watcher = await watchConfig(
 *   "/path/to/project",
 *   (newConfig, event) => {
 *     console.log("Config changed:", event.path);
 *     applyConfig(newConfig);
 *   },
 *   { debounceMs: 200 }
 * );
 *
 * // 나중에 정리
 * watcher.stop();
 * ```
 */
export async function watchConfig(
  rootDir: string,
  onReload: ConfigChangeCallback,
  options: WatchConfigOptions = {}
): Promise<ConfigWatcher> {
  const { debounceMs = 100, immediate = false, onError } = options;

  // 현재 설정 로드
  let currentConfig = await loadManduConfig(rootDir);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watchers: FSWatcher[] = [];
  let isWatching = true;

  // 감시 대상 파일들
  const configFiles = [
    "mandu.config.ts",
    "mandu.config.js",
    "mandu.config.json",
    ".mandu/guard.json",
  ];

  /**
   * 설정 리로드 수행
   */
  const doReload = async (changedPath: string): Promise<void> => {
    if (!isWatching) return;

    try {
      const previous = currentConfig;
      const newConfig = await loadManduConfig(rootDir);

      // 설정이 동일하면 무시
      if (JSON.stringify(previous) === JSON.stringify(newConfig)) {
        return;
      }

      // 이전에 설정이 있었는데 새 설정이 비어있으면 (파싱 에러 등)
      // 기존 설정 유지하고 에러 핸들러 호출
      const previousHasContent = Object.keys(previous).length > 0;
      const newIsEmpty = Object.keys(newConfig).length === 0;

      if (previousHasContent && newIsEmpty) {
        if (onError) {
          onError(new Error(`Failed to reload config from ${changedPath}`));
        }
        return; // 기존 설정 유지
      }

      currentConfig = newConfig;

      const event: ConfigChangeEvent = {
        previous,
        current: newConfig,
        path: changedPath,
        timestamp: new Date(),
      };

      onReload(newConfig, event);
    } catch (error) {
      if (onError && error instanceof Error) {
        onError(error);
      }
      // 에러 시 기존 설정 유지
    }
  };

  /**
   * 디바운스된 리로드
   */
  const scheduleReload = (changedPath: string): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      doReload(changedPath);
    }, debounceMs);
  };

  // 각 설정 파일 감시 시작
  for (const fileName of configFiles) {
    const filePath = `${rootDir}/${fileName}`;

    try {
      const watcher = watch(filePath, (eventType) => {
        if (eventType === "change" && isWatching) {
          scheduleReload(filePath);
        }
      });

      watcher.on("error", () => {
        // 파일이 없거나 접근 불가 - 무시
      });

      watchers.push(watcher);
    } catch {
      // 파일이 없으면 감시 생략
    }
  }

  // 초기 콜백 호출
  if (immediate) {
    const event: ConfigChangeEvent = {
      previous: {},
      current: currentConfig,
      path: rootDir,
      timestamp: new Date(),
    };
    onReload(currentConfig, event);
  }

  return {
    stop: () => {
      isWatching = false;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers = [];
    },

    getConfig: () => currentConfig,

    reload: async () => {
      const previous = currentConfig;
      currentConfig = await loadManduConfig(rootDir);

      if (JSON.stringify(previous) !== JSON.stringify(currentConfig)) {
        const event: ConfigChangeEvent = {
          previous,
          current: currentConfig,
          path: rootDir,
          timestamp: new Date(),
        };
        onReload(currentConfig, event);
      }

      return currentConfig;
    },
  };
}

/**
 * 간단한 단일 파일 감시
 *
 * @example
 * ```ts
 * const stop = watchConfigFile(
 *   "/path/to/mandu.config.ts",
 *   async (path) => {
 *     const config = await loadManduConfig(dirname(path));
 *     applyConfig(config);
 *   }
 * );
 *
 * // 정리
 * stop();
 * ```
 */
export function watchConfigFile(
  filePath: string,
  onChange: (path: string) => void,
  debounceMs = 100
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(filePath, (eventType) => {
      if (eventType === "change") {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          onChange(filePath);
        }, debounceMs);
      }
    });
  } catch {
    // 파일 없음 - 빈 함수 반환
    return () => {};
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
}

/**
 * 설정 변경 감지 헬퍼
 *
 * 특정 설정 섹션의 변경 여부 확인
 */
export function hasConfigChanged(
  previous: ManduConfig,
  current: ManduConfig,
  section?: keyof ManduConfig
): boolean {
  if (section) {
    return JSON.stringify(previous[section]) !== JSON.stringify(current[section]);
  }
  return JSON.stringify(previous) !== JSON.stringify(current);
}

/**
 * 변경된 설정 섹션 목록
 */
export function getChangedSections(
  previous: ManduConfig,
  current: ManduConfig
): (keyof ManduConfig)[] {
  const sections: (keyof ManduConfig)[] = [
    "server",
    "guard",
    "build",
    "dev",
    "fsRoutes",
    "seo",
  ];

  return sections.filter(
    (section) =>
      JSON.stringify(previous[section]) !== JSON.stringify(current[section])
  );
}
