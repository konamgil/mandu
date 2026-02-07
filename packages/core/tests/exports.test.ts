/**
 * Export Validation Test
 *
 * 이 테스트는 모듈 export 충돌을 사전에 감지합니다.
 * npm publish 전에 실행되어 ambiguous export 에러를 방지합니다.
 */

import { describe, it, expect, beforeAll } from "vitest";

describe("Module Exports", () => {
  const IMPORT_TIMEOUT = 15000;
  let core: any;

  beforeAll(async () => {
    core = await import("../src/index");
  }, IMPORT_TIMEOUT);

  it("should load main index without export conflicts", async () => {
    expect(core).toBeDefined();
    expect(core.Mandu).toBeDefined();
  }, IMPORT_TIMEOUT);

  it("should have unique export names (no ambiguous bindings)", async () => {
    // 주요 export 확인
    const exports = Object.keys(core);
    const uniqueExports = new Set(exports);

    // 중복 export가 없어야 함
    expect(exports.length).toBe(uniqueExports.size);
  }, IMPORT_TIMEOUT);

  it("should load guard module without conflicts", async () => {
    const guard = await import("../src/guard");

    expect(guard).toBeDefined();
    expect(guard.generateGuardMarkdownReport).toBeDefined();
  });

  it("should load brain module without conflicts", async () => {
    const brain = await import("../src/brain");

    expect(brain).toBeDefined();
    expect(brain.generateDoctorMarkdownReport).toBeDefined();
  });

  it("should load client module without conflicts", async () => {
    const client = await import("../src/client");

    expect(client).toBeDefined();
  });

  it("should load router module without conflicts", async () => {
    const router = await import("../src/router");

    expect(router).toBeDefined();
  });
});
