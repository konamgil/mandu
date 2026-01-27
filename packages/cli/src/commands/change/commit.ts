import { commitChange } from "@mandujs/core";
import { getRootDir } from "../../util/fs";

export async function changeCommit(): Promise<boolean> {
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Change Commit`);

  try {
    const result = await commitChange(rootDir);

    console.log(`✅ 변경 확정됨`);
    console.log(`   ID: ${result.changeId}`);
    if (result.message) {
      console.log(`   메시지: ${result.message}`);
    }

    return true;
  } catch (error) {
    console.error(`❌ 커밋 실패: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
