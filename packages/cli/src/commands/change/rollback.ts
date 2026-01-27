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
      console.log(`✅ 롤백 완료`);
      console.log(`   ID: ${result.changeId}`);
      console.log(`   복원된 파일: ${result.restoreResult.restoredFiles.length}개`);

      for (const file of result.restoreResult.restoredFiles) {
        console.log(`     - ${file}`);
      }
    } else {
      console.log(`⚠️  롤백 부분 완료`);
      console.log(`   ID: ${result.changeId}`);
      console.log(`   복원된 파일: ${result.restoreResult.restoredFiles.length}개`);
      console.log(`   실패한 파일: ${result.restoreResult.failedFiles.length}개`);

      for (const error of result.restoreResult.errors) {
        console.error(`     - ${error}`);
      }
    }

    return result.success;
  } catch (error) {
    console.error(`❌ 롤백 실패: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
