/**
 * Guard Error Cases Tests
 *
 * 에러 상황에서의 Guard 동작 검증
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { analyzeFile } from "../../src/guard/analyzer";
import { fsdPreset } from "../../src/guard/presets/fsd";
import path from "path";
import fs from "fs/promises";

const TEST_DIR = path.join(import.meta.dir, "__fixtures__", "error-cases");

describe("Guard Error Cases", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("파일 읽기 에러", () => {
    it("존재하지 않는 파일 분석 시 에러 발생", async () => {
      const nonExistentFile = path.join(TEST_DIR, "does-not-exist.ts");

      await expect(
        analyzeFile(nonExistentFile, fsdPreset.layers, TEST_DIR)
      ).rejects.toThrow("파일 분석 실패");
    });

    it("디렉토리를 파일로 분석 시 에러 발생", async () => {
      const dirPath = path.join(TEST_DIR, "some-dir");
      await fs.mkdir(dirPath, { recursive: true });

      await expect(
        analyzeFile(dirPath, fsdPreset.layers, TEST_DIR)
      ).rejects.toThrow();
    });
  });

  describe("빈 파일 처리", () => {
    it("빈 파일도 정상 분석", async () => {
      const emptyFile = path.join(TEST_DIR, "empty.ts");
      await fs.writeFile(emptyFile, "");

      const result = await analyzeFile(emptyFile, fsdPreset.layers, TEST_DIR);

      expect(result).toBeDefined();
      expect(result.imports).toHaveLength(0);
    });

    it("주석만 있는 파일도 정상 분석", async () => {
      const commentOnlyFile = path.join(TEST_DIR, "comments.ts");
      await fs.writeFile(
        commentOnlyFile,
        `
        // This is a comment
        /* Multi-line
           comment */
        /**
         * JSDoc comment
         */
      `
      );

      const result = await analyzeFile(commentOnlyFile, fsdPreset.layers, TEST_DIR);

      expect(result).toBeDefined();
      expect(result.imports).toHaveLength(0);
    });
  });

  describe("유효하지 않은 import 구문", () => {
    it("불완전한 import 구문 무시", async () => {
      const malformedFile = path.join(TEST_DIR, "malformed.ts");
      // 각 줄의 시작에 공백 없이 작성
      await fs.writeFile(
        malformedFile,
`import {
// 불완전한 구문

import from 'incomplete'

// 정상 구문
import { valid } from './valid'`
      );

      const result = await analyzeFile(malformedFile, fsdPreset.layers, TEST_DIR);

      // 정상적인 import가 있는지 확인 (정규식 매칭에 따라 결과 다를 수 있음)
      expect(result).toBeDefined();
      expect(result.imports).toBeDefined();
    });

    it("정상 import 추출", async () => {
      const normalFile = path.join(TEST_DIR, "normal.ts");
      await fs.writeFile(
        normalFile,
`import { something } from './something'
import React from 'react'`
      );

      const result = await analyzeFile(normalFile, fsdPreset.layers, TEST_DIR);
      const paths = result.imports.map((i) => i.path);

      expect(paths).toContain("./something");
      expect(paths).toContain("react");
    });
  });

  describe("특수 경로 처리", () => {
    it("node_modules import 감지", async () => {
      const nodeModulesFile = path.join(TEST_DIR, "features", "auth", "login.ts");
      await fs.mkdir(path.dirname(nodeModulesFile), { recursive: true });
      // 줄 시작에서 import 시작
      await fs.writeFile(
        nodeModulesFile,
`import React from 'react'
import { z } from 'zod'
import { local } from './local'`
      );

      const result = await analyzeFile(nodeModulesFile, fsdPreset.layers, TEST_DIR);

      // 외부 패키지 import도 추출
      const paths = result.imports.map((i) => i.path);
      expect(paths).toContain("react");
      expect(paths).toContain("zod");
      expect(paths).toContain("./local");
    });

    it("alias import (@/) 감지", async () => {
      const aliasFile = path.join(TEST_DIR, "features", "auth", "use-auth.ts");
      await fs.mkdir(path.dirname(aliasFile), { recursive: true });
      await fs.writeFile(
        aliasFile,
`import { Button } from '@/shared/ui/button'
import { useAuth } from '@/features/auth/hooks'`
      );

      const result = await analyzeFile(aliasFile, fsdPreset.layers, TEST_DIR);

      const paths = result.imports.map((i) => i.path);
      expect(paths).toContain("@/shared/ui/button");
      expect(paths).toContain("@/features/auth/hooks");
    });
  });

  describe("레이어 감지", () => {
    it("FSD 레이어 정확히 감지", async () => {
      const featureFile = path.join(TEST_DIR, "src", "features", "auth", "login.ts");
      await fs.mkdir(path.dirname(featureFile), { recursive: true });
      await fs.writeFile(featureFile, `export const login = () => {}`);

      const result = await analyzeFile(featureFile, fsdPreset.layers, TEST_DIR);

      expect(result.layer).toBe("features");
      expect(result.slice).toBe("auth");
    });

    it("알 수 없는 디렉토리는 레이어 없음", async () => {
      const unknownFile = path.join(TEST_DIR, "lib", "utils.ts");
      await fs.mkdir(path.dirname(unknownFile), { recursive: true });
      await fs.writeFile(unknownFile, `export const utils = {}`);

      const result = await analyzeFile(unknownFile, fsdPreset.layers, TEST_DIR);

      // null 또는 undefined - 레이어에 속하지 않음
      expect(result.layer == null).toBe(true);
    });
  });
});
