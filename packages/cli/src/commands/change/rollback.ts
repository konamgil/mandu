import { rollbackChange } from "@mandujs/core";
import { getRootDir } from "../../util/fs";

export interface ChangeRollbackOptions {
  id?: string;
}

export async function changeRollback(options: ChangeRollbackOptions = {}): Promise<boolean> {
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Change Rollback`);

  try {
    const result = await rollbackChange(rootDir, options.id);

    if (result.success) {
      console.log(`✅ Rollback complete`);
      console.log(`   ID: ${result.changeId}`);
      console.log(`   Restored files: ${result.restoreResult.restoredFiles.length}`);

      for (const file of result.restoreResult.restoredFiles) {
        console.log(`     - ${file}`);
      }
    } else {
      console.log(`⚠️  Rollback partially complete`);
      console.log(`   ID: ${result.changeId}`);
      console.log(`   Restored files: ${result.restoreResult.restoredFiles.length}`);
      console.log(`   Failed files: ${result.restoreResult.failedFiles.length}`);

      for (const error of result.restoreResult.errors) {
        console.error(`     - ${error}`);
      }
    }

    return result.success;
  } catch (error) {
    console.error(`❌ Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
