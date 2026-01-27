import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  beginChange,
  commitChange,
  rollbackChange,
  listChanges,
  getChange,
  pruneHistory,
  getChangeStats,
} from "../../packages/core/src/change";
import { rm, mkdir, writeFile } from "fs/promises";
import path from "path";

const TEST_DIR = path.join(import.meta.dir, ".test-history");

describe("History", () => {
  beforeEach(async () => {
    // 테스트 디렉토리 생성
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(path.join(TEST_DIR, "spec", "slots"), { recursive: true });
    await mkdir(path.join(TEST_DIR, "spec", "history", "snapshots"), { recursive: true });

    // 테스트용 manifest 생성
    await writeFile(
      path.join(TEST_DIR, "spec", "routes.manifest.json"),
      JSON.stringify({
        version: 1,
        routes: [
          {
            id: "home",
            pattern: "/",
            kind: "page",
            module: "server/home.ts",
            componentModule: "web/home.tsx",
          },
        ],
      })
    );
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("listChanges returns empty array when no changes", async () => {
    const changes = await listChanges(TEST_DIR);
    expect(changes).toEqual([]);
  });

  test("listChanges returns all changes", async () => {
    const change1 = await beginChange(TEST_DIR, { message: "First" });
    await commitChange(TEST_DIR);

    const change2 = await beginChange(TEST_DIR, { message: "Second" });
    await rollbackChange(TEST_DIR);

    const changes = await listChanges(TEST_DIR);
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.id)).toContain(change1.id);
    expect(changes.map((c) => c.id)).toContain(change2.id);
  });

  test("getChange returns specific change by ID", async () => {
    const change = await beginChange(TEST_DIR, { message: "Test" });
    await commitChange(TEST_DIR);

    const retrieved = await getChange(TEST_DIR, change.id);
    expect(retrieved?.id).toBe(change.id);
    expect(retrieved?.message).toBe("Test");
    expect(retrieved?.status).toBe("committed");
  });

  test("getChange returns null for non-existent ID", async () => {
    const result = await getChange(TEST_DIR, "non-existent");
    expect(result).toBeNull();
  });

  test("pruneHistory removes old snapshots", async () => {
    // 여러 트랜잭션 생성
    for (let i = 0; i < 5; i++) {
      await beginChange(TEST_DIR, { message: `Change ${i}` });
      await commitChange(TEST_DIR);
      // ID 차이를 위한 지연
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const statsBefore = await getChangeStats(TEST_DIR);
    expect(statsBefore.snapshotCount).toBe(5);

    // 2개만 유지
    const deleted = await pruneHistory(TEST_DIR, 2);
    expect(deleted).toHaveLength(3);

    const statsAfter = await getChangeStats(TEST_DIR);
    expect(statsAfter.snapshotCount).toBe(2);
  });

  test("pruneHistory does not remove active transaction snapshot", async () => {
    // 커밋된 트랜잭션 생성
    for (let i = 0; i < 3; i++) {
      await beginChange(TEST_DIR, { message: `Change ${i}` });
      await commitChange(TEST_DIR);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // 활성 트랜잭션 생성
    const activeChange = await beginChange(TEST_DIR, { message: "Active" });

    // 1개만 유지 (활성 트랜잭션 스냅샷은 보존되어야 함)
    const deleted = await pruneHistory(TEST_DIR, 1);

    // 활성 트랜잭션 스냅샷은 삭제되지 않음
    const hasActive = await getChange(TEST_DIR, activeChange.id);
    expect(hasActive).not.toBeNull();
  });

  test("getChangeStats returns correct statistics", async () => {
    // 커밋된 트랜잭션
    await beginChange(TEST_DIR, { message: "Committed 1" });
    await commitChange(TEST_DIR);

    await beginChange(TEST_DIR, { message: "Committed 2" });
    await commitChange(TEST_DIR);

    // 롤백된 트랜잭션
    await beginChange(TEST_DIR, { message: "Rolled back" });
    await rollbackChange(TEST_DIR);

    // 활성 트랜잭션
    await beginChange(TEST_DIR, { message: "Active" });

    const stats = await getChangeStats(TEST_DIR);
    expect(stats.total).toBe(4);
    expect(stats.active).toBe(1);
    expect(stats.committed).toBe(2);
    expect(stats.rolledBack).toBe(1);
    expect(stats.snapshotCount).toBe(4);
  });
});
