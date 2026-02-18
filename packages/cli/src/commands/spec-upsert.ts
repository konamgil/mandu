import { loadManifest, writeLock, readLock } from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";
import path from "path";

export interface SpecUpsertOptions {
  file?: string;
}

export async function specUpsert(options: SpecUpsertOptions): Promise<boolean> {
  console.warn("⚠️  DEPRECATED: spec-upsert is no longer needed.");
  console.warn("   FS Routes (app/) is the sole route source.");
  console.warn("   Use 'bunx mandu routes generate' instead.\n");

  const specPath = options.file
    ? resolveFromCwd(options.file)
    : resolveFromCwd(".mandu/routes.manifest.json");

  console.log(`🥟 Mandu Spec Upsert`);
  console.log(`📄 Spec file: ${specPath}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec validation failed:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec validation passed`);
  console.log(`   - Version: ${result.data.version}`);
  console.log(`   - Routes: ${result.data.routes.length}`);

  for (const route of result.data.routes) {
    const kindIcon = route.kind === "api" ? "📡" : "📄";
    console.log(`   ${kindIcon} ${route.id}: ${route.pattern} (${route.kind})`);
  }

  const lockPath = resolveFromCwd(".mandu/spec.lock.json");
  const previousLock = await readLock(lockPath);
  const newLock = await writeLock(lockPath, result.data);

  console.log(`\n🔒 Lock file updated: ${lockPath}`);
  console.log(`   - Previous hash: ${previousLock?.routesHash?.slice(0, 12) || "(none)"}...`);
  console.log(`   - New hash: ${newLock.routesHash.slice(0, 12)}...`);
  console.log(`   - Updated at: ${newLock.updatedAt}`);

  console.log(`\n✅ spec-upsert complete`);
  console.log(`💡 Next step: bunx mandu generate`);

  return true;
}
