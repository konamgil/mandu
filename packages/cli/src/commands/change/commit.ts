import { commitChange } from "@mandujs/core/compat/change/index";
import { getRootDir } from "../../util/fs";

export async function changeCommit(): Promise<boolean> {
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Change Commit`);

  try {
    const result = await commitChange(rootDir);

    console.log(`✅ Change committed`);
    console.log(`   ID: ${result.changeId}`);
    if (result.message) {
      console.log(`   Message: ${result.message}`);
    }

    return true;
  } catch (error) {
    console.error(`❌ Commit failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
