/**
 * 설정 Diff 시스템 테스트
 *
 * @see docs/plans/08_ont-run_adoption_plan.md - 섹션 7.1
 */

import { describe, expect, it } from "bun:test";
import {
  diffConfig,
  formatConfigDiff,
  summarizeDiff,
  hasConfigChanges,
} from "./differ.js";

describe("diffConfig", () => {
  it("should detect added MCP servers", () => {
    const oldConfig = { mcpServers: {} };
    const newConfig = {
      mcpServers: {
        sequential: { command: "npx", args: ["-y", "@mcp/sequential"] },
      },
    };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.mcpServers.added).toContain("sequential");
    expect(diff.mcpServers.removed).toHaveLength(0);
    expect(diff.mcpServers.modified).toHaveLength(0);
  });

  it("should detect removed MCP servers", () => {
    const oldConfig = {
      mcpServers: {
        context7: { command: "npx", args: ["-y", "@mcp/context7"] },
      },
    };
    const newConfig = { mcpServers: {} };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.mcpServers.removed).toContain("context7");
    expect(diff.mcpServers.added).toHaveLength(0);
  });

  it("should detect modified MCP servers", () => {
    const oldConfig = {
      mcpServers: {
        api: { url: "http://old-url.com", port: 3000 },
      },
    };
    const newConfig = {
      mcpServers: {
        api: { url: "http://new-url.com", port: 3000 },
      },
    };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.mcpServers.modified).toHaveLength(1);
    expect(diff.mcpServers.modified[0].name).toBe("api");
    expect(diff.mcpServers.modified[0].changes.url).toEqual({
      old: "http://old-url.com",
      new: "http://new-url.com",
    });
  });

  it("should detect modified project config values", () => {
    const oldConfig = { port: 3000, debug: false };
    const newConfig = { port: 3001, debug: false };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.projectConfig.modified).toHaveLength(1);
    expect(diff.projectConfig.modified[0]).toEqual({
      key: "port",
      old: 3000,
      new: 3001,
    });
  });

  it("should detect added project config keys", () => {
    const oldConfig = { port: 3000 };
    const newConfig = { port: 3000, newFeature: true };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.projectConfig.added).toContain("newFeature");
  });

  it("should detect removed project config keys", () => {
    const oldConfig = { port: 3000, deprecated: true };
    const newConfig = { port: 3000 };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.projectConfig.removed).toContain("deprecated");
  });

  it("should return hasChanges=false when configs are identical", () => {
    const config = {
      port: 3000,
      mcpServers: {
        api: { url: "http://example.com" },
      },
    };

    const diff = diffConfig(config, { ...config });

    expect(diff.hasChanges).toBe(false);
  });

  it("should handle empty configs", () => {
    const diff = diffConfig({}, {});

    expect(diff.hasChanges).toBe(false);
  });

  it("should handle nested object changes", () => {
    const oldConfig = {
      features: {
        islands: true,
        ssr: { enabled: true, streaming: false },
      },
    };
    const newConfig = {
      features: {
        islands: true,
        ssr: { enabled: true, streaming: true },
      },
    };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
  });

  it("should handle array changes", () => {
    const oldConfig = { plugins: ["a", "b"] };
    const newConfig = { plugins: ["a", "b", "c"] };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.projectConfig.modified[0].key).toBe("plugins");
  });
});

describe("formatConfigDiff", () => {
  it("should format diff with colors by default", () => {
    const diff = diffConfig(
      { port: 3000 },
      { port: 3001 }
    );

    const formatted = formatConfigDiff(diff);

    expect(formatted).toContain("변경 감지");
    expect(formatted).toContain("port");
  });

  it("should format diff without colors when disabled", () => {
    const diff = diffConfig(
      { port: 3000 },
      { port: 3001 }
    );

    const formatted = formatConfigDiff(diff, { color: false });

    expect(formatted).toContain("변경 감지");
    // ANSI 코드가 없어야 함
    expect(formatted).not.toContain("\x1b[");
  });

  it("should redact secrets by default in formatted diff", () => {
    const oldConfig = {
      mcpServers: {
        api: { url: "http://api.com", token: "old-secret-123" },
      },
    };
    const newConfig = {
      mcpServers: {
        api: { url: "http://api.com", token: "new-secret-456" },
      },
    };

    const diff = diffConfig(oldConfig, newConfig);
    const formatted = formatConfigDiff(diff, { verbose: true });

    expect(formatted).toContain("***");
    expect(formatted).not.toContain("old-secret-123");
    expect(formatted).not.toContain("new-secret-456");
  });

  it("should show secrets when showSecrets is true", () => {
    const oldConfig = {
      mcpServers: {
        api: { token: "old-secret" },
      },
    };
    const newConfig = {
      mcpServers: {
        api: { token: "new-secret" },
      },
    };

    const diff = diffConfig(oldConfig, newConfig);
    const formatted = formatConfigDiff(diff, {
      verbose: true,
      showSecrets: true,
    });

    expect(formatted).toContain("old-secret");
    expect(formatted).toContain("new-secret");
  });

  it("should redact various sensitive key patterns", () => {
    const sensitiveKeys = [
      "token",
      "secret",
      "password",
      "api_key",
      "apikey",
      "authorization",
      "access_token",
      "private_key",
    ];

    for (const key of sensitiveKeys) {
      const oldConfig = { mcpServers: { test: { [key]: "old-value" } } };
      const newConfig = { mcpServers: { test: { [key]: "new-value" } } };

      const diff = diffConfig(oldConfig, newConfig);
      const formatted = formatConfigDiff(diff, { verbose: true });

      expect(formatted).toContain("***");
      expect(formatted).not.toContain("old-value");
    }
  });

  it("should show no changes message when identical", () => {
    const config = { port: 3000 };
    const diff = diffConfig(config, config);
    const formatted = formatConfigDiff(diff);

    expect(formatted).toContain("변경사항 없음");
  });
});

describe("summarizeDiff", () => {
  it("should summarize diff changes", () => {
    const diff = diffConfig(
      { port: 3000, mcpServers: { a: {} } },
      { port: 3001, mcpServers: { b: {} } }
    );

    const summary = summarizeDiff(diff);

    expect(summary).toContain("MCP 서버");
    expect(summary).toContain("설정");
  });

  it("should return no changes message when identical", () => {
    const config = { port: 3000 };
    const diff = diffConfig(config, config);

    expect(summarizeDiff(diff)).toBe("변경사항 없음");
  });
});

describe("hasConfigChanges", () => {
  it("should return true when configs differ", () => {
    expect(hasConfigChanges({ a: 1 }, { a: 2 })).toBe(true);
  });

  it("should return false when configs are identical", () => {
    expect(hasConfigChanges({ a: 1 }, { a: 1 })).toBe(false);
  });
});

describe("real-world scenarios", () => {
  it("should handle complex mandu config diff", () => {
    const oldConfig = {
      name: "my-project",
      port: 3000,
      mcpServers: {
        sequential: {
          command: "npx",
          args: ["-y", "@anthropic/sequential-mcp"],
        },
        magic: {
          command: "npx",
          args: ["-y", "@21st/magic-mcp"],
          env: { API_KEY: "secret-key-123" },
        },
      },
      features: {
        islands: true,
        ssr: true,
      },
    };

    const newConfig = {
      name: "my-project",
      port: 3001, // 변경
      mcpServers: {
        sequential: {
          command: "npx",
          args: ["-y", "@anthropic/sequential-mcp"],
        },
        // magic 삭제
        context7: {
          // 추가
          command: "npx",
          args: ["-y", "@context7/mcp"],
        },
      },
      features: {
        islands: true,
        ssr: true,
      },
    };

    const diff = diffConfig(oldConfig, newConfig);

    expect(diff.hasChanges).toBe(true);
    expect(diff.mcpServers.added).toContain("context7");
    expect(diff.mcpServers.removed).toContain("magic");
    expect(diff.projectConfig.modified.find((m) => m.key === "port")).toBeDefined();

    // 포맷 테스트
    const formatted = formatConfigDiff(diff, { color: false, verbose: true });
    expect(formatted).toContain("context7");
    expect(formatted).toContain("magic");
    expect(formatted).toContain("port");
  });
});
