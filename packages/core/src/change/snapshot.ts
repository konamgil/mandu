import path from "path";
import type { Snapshot, RestoreResult } from "./types";
import type { RoutesManifest } from "../spec/schema";
import type { SpecLock } from "../spec/lock";

const SPEC_DIR = "spec";
const MANIFEST_FILE = "routes.manifest.json";
const LOCK_FILE = "spec.lock.json";
const SLOTS_DIR = "slots";
const HISTORY_DIR = "history";
const SNAPSHOTS_DIR = "snapshots";

/**
 * 스냅샷 ID 생성 (YYYYMMDD-HHmmss-xxx)
 */
function generateSnapshotId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const random = Math.random().toString(36).slice(2, 5);
  return `${date}-${time}-${random}`;
}

/**
 * 스냅샷 저장 경로 반환
 */
function getSnapshotPath(rootDir: string, snapshotId: string): string {
  return path.join(rootDir, SPEC_DIR, HISTORY_DIR, SNAPSHOTS_DIR, `${snapshotId}.snapshot.json`);
}

/**
 * Slot 파일들의 내용을 수집
 */
async function collectSlotContents(rootDir: string): Promise<Record<string, string>> {
  const slotsDir = path.join(rootDir, SPEC_DIR, SLOTS_DIR);
  const contents: Record<string, string> = {};

  try {
    const entries = await Array.fromAsync(
      new Bun.Glob("**/*.ts").scan({
        cwd: slotsDir,
        onlyFiles: true,
      })
    );

    await Promise.all(
      entries.map(async (entry) => {
        const filePath = path.join(slotsDir, entry);
        const file = Bun.file(filePath);
        if (await file.exists()) {
          contents[entry] = await file.text();
        }
      })
    );
  } catch {
    // slots 디렉토리가 없는 경우 빈 객체 반환
  }

  return contents;
}

/**
 * 현재 spec 상태의 스냅샷 생성
 */
export async function createSnapshot(rootDir: string): Promise<Snapshot> {
  const specDir = path.join(rootDir, SPEC_DIR);
  const manifestPath = path.join(specDir, MANIFEST_FILE);
  const lockPath = path.join(specDir, LOCK_FILE);

  // Manifest 읽기 (필수)
  const manifestFile = Bun.file(manifestPath);
  if (!(await manifestFile.exists())) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const manifest: RoutesManifest = await manifestFile.json();

  // Lock 읽기 (선택)
  let lock: SpecLock | null = null;
  const lockFile = Bun.file(lockPath);
  if (await lockFile.exists()) {
    lock = await lockFile.json();
  }

  // Slot 내용 수집
  const slotContents = await collectSlotContents(rootDir);

  const id = generateSnapshotId();

  return {
    id,
    timestamp: new Date().toISOString(),
    manifest,
    lock,
    slotContents,
  };
}

/**
 * 스냅샷 파일 읽기
 */
export async function readSnapshot(snapshotPath: string): Promise<Snapshot | null> {
  try {
    const file = Bun.file(snapshotPath);
    if (!(await file.exists())) {
      return null;
    }
    return await file.json();
  } catch {
    return null;
  }
}

/**
 * 스냅샷 파일 저장
 */
export async function writeSnapshot(rootDir: string, snapshot: Snapshot): Promise<void> {
  const snapshotPath = getSnapshotPath(rootDir, snapshot.id);
  const snapshotDir = path.dirname(snapshotPath);

  // 디렉토리 생성
  await Bun.write(path.join(snapshotDir, ".gitkeep"), "");

  // 스냅샷 저장
  await Bun.write(snapshotPath, JSON.stringify(snapshot, null, 2));
}

/**
 * 스냅샷 ID로 스냅샷 읽기
 */
export async function readSnapshotById(rootDir: string, snapshotId: string): Promise<Snapshot | null> {
  const snapshotPath = getSnapshotPath(rootDir, snapshotId);
  return readSnapshot(snapshotPath);
}

/**
 * 스냅샷으로부터 상태 복원
 */
export async function restoreSnapshot(rootDir: string, snapshot: Snapshot): Promise<RestoreResult> {
  const specDir = path.join(rootDir, SPEC_DIR);
  const manifestPath = path.join(specDir, MANIFEST_FILE);
  const lockPath = path.join(specDir, LOCK_FILE);
  const slotsDir = path.join(specDir, SLOTS_DIR);

  const restoredFiles: string[] = [];
  const failedFiles: string[] = [];
  const errors: string[] = [];

  // 1. Manifest 복원
  try {
    await Bun.write(manifestPath, JSON.stringify(snapshot.manifest, null, 2));
    restoredFiles.push(MANIFEST_FILE);
  } catch (error) {
    failedFiles.push(MANIFEST_FILE);
    errors.push(`Failed to restore manifest: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Lock 복원 (있는 경우)
  if (snapshot.lock) {
    try {
      await Bun.write(lockPath, JSON.stringify(snapshot.lock, null, 2));
      restoredFiles.push(LOCK_FILE);
    } catch (error) {
      failedFiles.push(LOCK_FILE);
      errors.push(`Failed to restore lock: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Slot 파일들 복원
  for (const [relativePath, content] of Object.entries(snapshot.slotContents)) {
    const filePath = path.join(slotsDir, relativePath);
    try {
      // 디렉토리 확보
      const dir = path.dirname(filePath);
      await Bun.write(path.join(dir, ".gitkeep"), "");

      await Bun.write(filePath, content);
      restoredFiles.push(`${SLOTS_DIR}/${relativePath}`);
    } catch (error) {
      failedFiles.push(`${SLOTS_DIR}/${relativePath}`);
      errors.push(
        `Failed to restore slot ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    success: failedFiles.length === 0,
    restoredFiles,
    failedFiles,
    errors,
  };
}

/**
 * 스냅샷 삭제
 */
export async function deleteSnapshot(rootDir: string, snapshotId: string): Promise<boolean> {
  const snapshotPath = getSnapshotPath(rootDir, snapshotId);
  try {
    const file = Bun.file(snapshotPath);
    if (await file.exists()) {
      const { unlink } = await import("fs/promises");
      await unlink(snapshotPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 모든 스냅샷 ID 목록 조회
 */
export async function listSnapshotIds(rootDir: string): Promise<string[]> {
  const snapshotsDir = path.join(rootDir, SPEC_DIR, HISTORY_DIR, SNAPSHOTS_DIR);

  try {
    const entries = await Array.fromAsync(
      new Bun.Glob("*.snapshot.json").scan({
        cwd: snapshotsDir,
        onlyFiles: true,
      })
    );

    return entries
      .map((entry) => entry.replace(".snapshot.json", ""))
      .sort()
      .reverse(); // 최신 순
  } catch {
    return [];
  }
}
