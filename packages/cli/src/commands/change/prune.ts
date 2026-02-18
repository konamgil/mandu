import { pruneHistory, DEFAULT_HISTORY_CONFIG } from "@mandujs/core";
import { getRootDir } from "../../util/fs";

export interface ChangePruneOptions {
  keep?: number;
}

export async function changePrune(options: ChangePruneOptions = {}): Promise<boolean> {
  const rootDir = getRootDir();
  const keepCount = options.keep ?? DEFAULT_HISTORY_CONFIG.maxSnapshots;

  console.log(`🥟 Mandu Change Prune`);
  console.log(`   Snapshots to keep: ${keepCount}\n`);

  try {
    const deletedIds = await pruneHistory(rootDir, keepCount);

    if (deletedIds.length === 0) {
      console.log(`✅ No snapshots to prune`);
    } else {
      console.log(`🗑️  Deleted snapshots: ${deletedIds.length}`);
      for (const id of deletedIds) {
        console.log(`   - ${id}`);
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ Prune failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
