import path from "path";
import type { ChangeRecord, HistoryConfig } from "./types";
import { deleteSnapshot, listSnapshotIds } from "./snapshot";
import { DEFAULT_HISTORY_CONFIG } from "./types";

const SPEC_DIR = "spec";
const HISTORY_DIR = "history";
const CHANGES_FILE = "changes.json";

/**
 * Changes 파일 경로
 */
function getChangesPath(rootDir: string): string {
  return path.join(rootDir, SPEC_DIR, HISTORY_DIR, CHANGES_FILE);
}

/**
 * 모든 변경 기록 조회
 */
export async function listChanges(rootDir: string): Promise<ChangeRecord[]> {
  const changesPath = getChangesPath(rootDir);
  try {
    const file = Bun.file(changesPath);
    if (!(await file.exists())) {
      return [];
    }
    return await file.json();
  } catch {
    return [];
  }
}

/**
 * 특정 변경 기록 조회
 */
export async function getChange(rootDir: string, id: string): Promise<ChangeRecord | null> {
  const changes = await listChanges(rootDir);
  return changes.find((c) => c.id === id) || null;
}

/**
 * 변경 기록 저장
 */
async function writeChanges(rootDir: string, changes: ChangeRecord[]): Promise<void> {
  const changesPath = getChangesPath(rootDir);
  const historyDir = path.join(rootDir, SPEC_DIR, HISTORY_DIR);

  // 디렉토리 확보
  await Bun.write(path.join(historyDir, ".gitkeep"), "");

  await Bun.write(changesPath, JSON.stringify(changes, null, 2));
}

/**
 * 오래된 스냅샷 정리
 * @param rootDir 프로젝트 루트 디렉토리
 * @param keepCount 유지할 스냅샷 수 (기본: 5)
 * @returns 삭제된 스냅샷 ID 목록
 */
export async function pruneHistory(
  rootDir: string,
  keepCount: number = DEFAULT_HISTORY_CONFIG.maxSnapshots
): Promise<string[]> {
  const deletedIds: string[] = [];

  // 모든 스냅샷 ID 조회 (최신 순으로 정렬됨)
  const snapshotIds = await listSnapshotIds(rootDir);

  if (snapshotIds.length <= keepCount) {
    return deletedIds;
  }

  // 변경 기록 조회
  const changes = await listChanges(rootDir);

  // 활성 트랜잭션의 스냅샷 ID 수집 (삭제 불가)
  const activeSnapshotIds = new Set(
    changes.filter((c) => c.status === "active").map((c) => c.snapshotId)
  );

  // 유지할 스냅샷 외의 것들 삭제
  const toDelete = snapshotIds.slice(keepCount);

  for (const snapshotId of toDelete) {
    // 활성 트랜잭션의 스냅샷은 삭제하지 않음
    if (activeSnapshotIds.has(snapshotId)) {
      continue;
    }

    const deleted = await deleteSnapshot(rootDir, snapshotId);
    if (deleted) {
      deletedIds.push(snapshotId);
    }
  }

  // 삭제된 스냅샷에 연결된 변경 기록도 정리
  if (deletedIds.length > 0) {
    const deletedSet = new Set(deletedIds);
    const remainingChanges = changes.filter((c) => {
      // 활성 상태는 유지
      if (c.status === "active") {
        return true;
      }
      // 스냅샷이 삭제되지 않은 것만 유지
      return !deletedSet.has(c.snapshotId);
    });

    await writeChanges(rootDir, remainingChanges);
  }

  return deletedIds;
}

/**
 * History 설정 로드 (향후 mandu.config.json에서 로드)
 */
export async function loadHistoryConfig(rootDir: string): Promise<HistoryConfig> {
  // 향후 mandu.config.json에서 로드하도록 확장
  // 현재는 기본값 반환
  return DEFAULT_HISTORY_CONFIG;
}

/**
 * 변경 통계 조회
 */
export async function getChangeStats(
  rootDir: string
): Promise<{
  total: number;
  active: number;
  committed: number;
  rolledBack: number;
  snapshotCount: number;
}> {
  const changes = await listChanges(rootDir);
  const snapshotIds = await listSnapshotIds(rootDir);

  return {
    total: changes.length,
    active: changes.filter((c) => c.status === "active").length,
    committed: changes.filter((c) => c.status === "committed").length,
    rolledBack: changes.filter((c) => c.status === "rolled_back").length,
    snapshotCount: snapshotIds.length,
  };
}
