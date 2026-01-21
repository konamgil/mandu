import { loadManifest } from "../../../core/src/spec/load";
import { writeLock, readLock } from "../../../core/src/spec/lock";
import { resolveFromCwd } from "../util/fs";
import path from "path";

export interface SpecUpsertOptions {
  file?: string;
}

export async function specUpsert(options: SpecUpsertOptions): Promise<boolean> {
  const specPath = options.file
    ? resolveFromCwd(options.file)
    : resolveFromCwd("spec/routes.manifest.json");

  console.log(`🥟 Mandu Spec Upsert`);
  console.log(`📄 Spec 파일: ${specPath}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec 검증 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec 검증 통과`);
  console.log(`   - 버전: ${result.data.version}`);
  console.log(`   - 라우트 수: ${result.data.routes.length}`);

  for (const route of result.data.routes) {
    const kindIcon = route.kind === "api" ? "📡" : "📄";
    console.log(`   ${kindIcon} ${route.id}: ${route.pattern} (${route.kind})`);
  }

  const lockPath = resolveFromCwd("spec/spec.lock.json");
  const previousLock = await readLock(lockPath);
  const newLock = await writeLock(lockPath, result.data);

  console.log(`\n🔒 Lock 파일 갱신: ${lockPath}`);
  console.log(`   - 이전 해시: ${previousLock?.routesHash?.slice(0, 12) || "(없음)"}...`);
  console.log(`   - 새 해시: ${newLock.routesHash.slice(0, 12)}...`);
  console.log(`   - 갱신 시간: ${newLock.updatedAt}`);

  console.log(`\n✅ spec-upsert 완료`);
  console.log(`💡 다음 단계: bunx mandu generate`);

  return true;
}
