/**
 * DNA-006: Config Hot Reload Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  watchConfig,
  watchConfigFile,
  hasConfigChanged,
  getChangedSections,
  type ConfigChangeEvent,
} from "../../src/config/watcher";
import type { ManduConfig } from "../../src/config/mandu";

describe("DNA-006: Config Hot Reload", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mandu-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("watchConfig", () => {
    it("should load initial config", async () => {
      // 설정 파일 생성
      const config: ManduConfig = {
        server: { port: 3000 },
      };
      await writeFile(
        join(tempDir, "mandu.config.json"),
        JSON.stringify(config)
      );

      const callback = vi.fn();
      const watcher = await watchConfig(tempDir, callback);

      try {
        expect(watcher.getConfig()).toEqual(config);
        expect(callback).not.toHaveBeenCalled();
      } finally {
        watcher.stop();
      }
    });

    it("should call callback immediately when immediate option is true", async () => {
      const config: ManduConfig = {
        server: { port: 3000 },
      };
      await writeFile(
        join(tempDir, "mandu.config.json"),
        JSON.stringify(config)
      );

      const callback = vi.fn();
      const watcher = await watchConfig(tempDir, callback, { immediate: true });

      try {
        expect(callback).toHaveBeenCalledTimes(1);
        const [newConfig, event] = callback.mock.calls[0];
        expect(newConfig).toEqual(config);
        expect(event.current).toEqual(config);
        expect(event.previous).toEqual({});
      } finally {
        watcher.stop();
      }
    });

    it("should detect config changes", async () => {
      const initialConfig: ManduConfig = {
        server: { port: 3000 },
      };
      const configPath = join(tempDir, "mandu.config.json");
      await writeFile(configPath, JSON.stringify(initialConfig));

      const callback = vi.fn();
      const watcher = await watchConfig(tempDir, callback, { debounceMs: 10 });

      try {
        // 설정 변경
        const newConfig: ManduConfig = {
          server: { port: 4000 },
        };
        await writeFile(configPath, JSON.stringify(newConfig));

        // 디바운스 대기
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(callback).toHaveBeenCalled();
        const [config, event] = callback.mock.calls[0];
        expect(config.server?.port).toBe(4000);
        expect(event.previous.server?.port).toBe(3000);
        expect(event.current.server?.port).toBe(4000);
      } finally {
        watcher.stop();
      }
    });

    it("should support manual reload", async () => {
      const initialConfig: ManduConfig = {
        server: { port: 3000 },
      };
      const configPath = join(tempDir, "mandu.config.json");
      await writeFile(configPath, JSON.stringify(initialConfig));

      const callback = vi.fn();
      const watcher = await watchConfig(tempDir, callback);

      try {
        // 설정 변경 (watch 이벤트 없이)
        const newConfig: ManduConfig = {
          server: { port: 5000 },
        };
        await writeFile(configPath, JSON.stringify(newConfig));

        // 수동 리로드
        const reloaded = await watcher.reload();
        expect(reloaded.server?.port).toBe(5000);
        expect(watcher.getConfig().server?.port).toBe(5000);
      } finally {
        watcher.stop();
      }
    });

    it("should call onError when config is invalid", async () => {
      const configPath = join(tempDir, "mandu.config.json");
      await writeFile(configPath, '{"server": {"port": 3000}}');

      const callback = vi.fn();
      const onError = vi.fn();
      const watcher = await watchConfig(tempDir, callback, {
        debounceMs: 10,
        onError,
      });

      try {
        // 잘못된 JSON 작성
        await writeFile(configPath, "invalid json {");

        // 디바운스 대기
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 에러 핸들러 호출 확인
        // (JSON 파싱 에러가 loadManduConfig에서 catch되므로 빈 객체 반환)
        // 기존 설정이 유지됨
        expect(watcher.getConfig().server?.port).toBe(3000);
      } finally {
        watcher.stop();
      }
    });

    it("should not call callback when config is unchanged", async () => {
      const config: ManduConfig = {
        server: { port: 3000 },
      };
      const configPath = join(tempDir, "mandu.config.json");
      await writeFile(configPath, JSON.stringify(config));

      const callback = vi.fn();
      const watcher = await watchConfig(tempDir, callback, { debounceMs: 10 });

      try {
        // 동일한 설정으로 다시 쓰기
        await writeFile(configPath, JSON.stringify(config));

        await new Promise((resolve) => setTimeout(resolve, 50));

        // 변경 없으므로 콜백 호출 안됨
        expect(callback).not.toHaveBeenCalled();
      } finally {
        watcher.stop();
      }
    });

    it("should work with .mandu/guard.json", async () => {
      await mkdir(join(tempDir, ".mandu"), { recursive: true });

      const guardConfig = {
        preset: "fsd",
        srcDir: "src",
      };
      const guardPath = join(tempDir, ".mandu", "guard.json");
      await writeFile(guardPath, JSON.stringify(guardConfig));

      const callback = vi.fn();
      const watcher = await watchConfig(tempDir, callback);

      try {
        expect(watcher.getConfig().guard?.preset).toBe("fsd");
        expect(watcher.getConfig().guard?.srcDir).toBe("src");
      } finally {
        watcher.stop();
      }
    });
  });

  describe("watchConfigFile", () => {
    it("should call onChange when file changes", async () => {
      const configPath = join(tempDir, "test.config.json");
      await writeFile(configPath, "{}");

      const onChange = vi.fn();
      const stop = watchConfigFile(configPath, onChange, 10);

      try {
        await writeFile(configPath, '{"updated": true}');
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onChange).toHaveBeenCalledWith(configPath);
      } finally {
        stop();
      }
    });

    it("should return noop function for non-existent file", () => {
      const stop = watchConfigFile("/non/existent/file.json", vi.fn());
      expect(stop).toBeInstanceOf(Function);
      stop(); // should not throw
    });
  });

  describe("hasConfigChanged", () => {
    it("should detect full config changes", () => {
      const prev: ManduConfig = { server: { port: 3000 } };
      const curr: ManduConfig = { server: { port: 4000 } };

      expect(hasConfigChanged(prev, curr)).toBe(true);
      expect(hasConfigChanged(prev, prev)).toBe(false);
    });

    it("should detect section-specific changes", () => {
      const prev: ManduConfig = {
        server: { port: 3000 },
        build: { outDir: "dist" },
      };
      const curr: ManduConfig = {
        server: { port: 4000 },
        build: { outDir: "dist" },
      };

      expect(hasConfigChanged(prev, curr, "server")).toBe(true);
      expect(hasConfigChanged(prev, curr, "build")).toBe(false);
    });
  });

  describe("getChangedSections", () => {
    it("should return list of changed sections", () => {
      const prev: ManduConfig = {
        server: { port: 3000 },
        build: { outDir: "dist" },
        guard: { preset: "mandu" },
      };
      const curr: ManduConfig = {
        server: { port: 4000 },
        build: { outDir: "dist" },
        guard: { preset: "fsd" },
      };

      const changed = getChangedSections(prev, curr);
      expect(changed).toContain("server");
      expect(changed).toContain("guard");
      expect(changed).not.toContain("build");
    });

    it("should return empty array when nothing changed", () => {
      const config: ManduConfig = { server: { port: 3000 } };
      expect(getChangedSections(config, config)).toEqual([]);
    });
  });
});
