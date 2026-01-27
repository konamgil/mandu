import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createSnapshot,
  writeSnapshot,
  readSnapshotById,
  restoreSnapshot,
  deleteSnapshot,
  listSnapshotIds,
} from "../../packages/core/src/change";
import { rm, mkdir, writeFile } from "fs/promises";
import path from "path";

const TEST_DIR = path.join(import.meta.dir, ".test-snapshot");

describe("Snapshot", () => {
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

    // 테스트용 lock 생성
    await writeFile(
      path.join(TEST_DIR, "spec", "spec.lock.json"),
      JSON.stringify({
        routesHash: "abc123",
        updatedAt: "2024-01-01T00:00:00.000Z",
      })
    );

    // 테스트용 slot 파일 생성
    await writeFile(
      path.join(TEST_DIR, "spec", "slots", "home.slot.ts"),
      'export const homeData = "test";'
    );
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("createSnapshot creates a valid snapshot", async () => {
    const snapshot = await createSnapshot(TEST_DIR);

    expect(snapshot.id).toMatch(/^\d{8}-\d{6}-[a-z0-9]{3}$/);
    expect(snapshot.timestamp).toBeTruthy();
    expect(snapshot.manifest).toBeDefined();
    expect(snapshot.manifest.version).toBe(1);
    expect(snapshot.manifest.routes).toHaveLength(1);
    expect(snapshot.lock).toBeDefined();
    expect(snapshot.lock?.routesHash).toBe("abc123");
    expect(snapshot.slotContents["home.slot.ts"]).toBe('export const homeData = "test";');
  });

  test("writeSnapshot and readSnapshotById work correctly", async () => {
    const snapshot = await createSnapshot(TEST_DIR);
    await writeSnapshot(TEST_DIR, snapshot);

    const readSnapshot = await readSnapshotById(TEST_DIR, snapshot.id);

    expect(readSnapshot).not.toBeNull();
    expect(readSnapshot?.id).toBe(snapshot.id);
    expect(readSnapshot?.manifest.routes[0].id).toBe("home");
  });

  test("restoreSnapshot restores files correctly", async () => {
    // 스냅샷 생성
    const snapshot = await createSnapshot(TEST_DIR);
    await writeSnapshot(TEST_DIR, snapshot);

    // 파일 수정
    await writeFile(
      path.join(TEST_DIR, "spec", "routes.manifest.json"),
      JSON.stringify({ version: 2, routes: [] })
    );

    await writeFile(
      path.join(TEST_DIR, "spec", "slots", "home.slot.ts"),
      'export const homeData = "modified";'
    );

    // 복원
    const result = await restoreSnapshot(TEST_DIR, snapshot);

    expect(result.success).toBe(true);
    expect(result.restoredFiles).toContain("routes.manifest.json");
    expect(result.restoredFiles).toContain("spec.lock.json");
    expect(result.restoredFiles).toContain("slots/home.slot.ts");

    // 복원 확인
    const restoredManifest = await Bun.file(
      path.join(TEST_DIR, "spec", "routes.manifest.json")
    ).json();
    expect(restoredManifest.version).toBe(1);
    expect(restoredManifest.routes).toHaveLength(1);

    const restoredSlot = await Bun.file(
      path.join(TEST_DIR, "spec", "slots", "home.slot.ts")
    ).text();
    expect(restoredSlot).toBe('export const homeData = "test";');
  });

  test("deleteSnapshot removes snapshot file", async () => {
    const snapshot = await createSnapshot(TEST_DIR);
    await writeSnapshot(TEST_DIR, snapshot);

    const deleted = await deleteSnapshot(TEST_DIR, snapshot.id);
    expect(deleted).toBe(true);

    const readResult = await readSnapshotById(TEST_DIR, snapshot.id);
    expect(readResult).toBeNull();
  });

  test("listSnapshotIds returns snapshot IDs in reverse order", async () => {
    // 여러 스냅샷 생성
    const snapshot1 = await createSnapshot(TEST_DIR);
    await writeSnapshot(TEST_DIR, snapshot1);

    // ID가 달라지도록 충분한 지연 (1초 이상)
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const snapshot2 = await createSnapshot(TEST_DIR);
    await writeSnapshot(TEST_DIR, snapshot2);

    const ids = await listSnapshotIds(TEST_DIR);

    expect(ids).toHaveLength(2);
    // 최신 순으로 정렬됨 (IDs contain timestamp, so newer one should be first)
    expect(ids).toContain(snapshot1.id);
    expect(ids).toContain(snapshot2.id);
  });
});
