import { pruneHistory, DEFAULT_HISTORY_CONFIG } from "@mandujs/core";
import { getRootDir } from "../../util/fs";

export interface ChangePruneOptions {
  keep?: number;
}

export async function changePrune(options: ChangePruneOptions = {}): Promise<boolean> {
  const rootDir = getRootDir();
  const keepCount = options.keep ?? DEFAULT_HISTORY_CONFIG.maxSnapshots;

  console.log(`🥟 Mandu Change Prune`);
  console.log(`   유지할 스냅샷: ${keepCount}개\n`);

  try {
    const deletedIds = await pruneHistory(rootDir, keepCount);

    if (deletedIds.length === 0) {
      console.log(`✅ 정리할 스냅샷이 없습니다`);
    } else {
      console.log(`🗑️  삭제된 스냅샷: ${deletedIds.length}개`);
      for (const id of deletedIds) {
        console.log(`   - ${id}`);
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ 정리 실패: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
