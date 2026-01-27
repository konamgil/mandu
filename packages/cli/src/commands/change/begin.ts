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

    console.log(`✅ 트랜잭션 시작됨`);
    console.log(`   ID: ${change.id}`);
    console.log(`   스냅샷: ${change.snapshotId}`);
    if (change.message) {
      console.log(`   메시지: ${change.message}`);
    }
    console.log(`\n💡 변경 작업 후 다음 명령을 실행하세요:`);
    console.log(`   확정: bunx mandu change commit`);
    console.log(`   롤백: bunx mandu change rollback`);

    return true;
  } catch (error) {
    console.error(`❌ 트랜잭션 시작 실패: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
