import { beginChange } from "@mandujs/core";
import { getRootDir } from "../../util/fs";

export interface ChangeBeginOptions {
  message?: string;
}

export async function changeBegin(options: ChangeBeginOptions = {}): Promise<boolean> {
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Change Begin`);

  try {
    const change = await beginChange(rootDir, {
      message: options.message,
    });

    console.log(`✅ Transaction started`);
    console.log(`   ID: ${change.id}`);
    console.log(`   Snapshot: ${change.snapshotId}`);
    if (change.message) {
      console.log(`   Message: ${change.message}`);
    }
    console.log(`\n💡 After making changes, run:`);
    console.log(`   Commit: bunx mandu change commit`);
    console.log(`   Rollback: bunx mandu change rollback`);

    return true;
  } catch (error) {
    console.error(`❌ Failed to start transaction: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
