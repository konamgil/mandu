import { createHash } from "crypto";
import type { RoutesManifest } from "./schema";

export interface SpecLock {
  routesHash: string;
  updatedAt: string;
}

export function computeHash(manifest: RoutesManifest): string {
  const content = JSON.stringify(manifest, null, 2);
  return createHash("sha256").update(content).digest("hex");
}

export async function readLock(lockPath: string): Promise<SpecLock | null> {
  try {
    const file = Bun.file(lockPath);
    const exists = await file.exists();

    if (!exists) {
      return null;
    }

    const content = await file.text();
    return JSON.parse(content) as SpecLock;
  } catch {
    return null;
  }
}

export async function writeLock(lockPath: string, manifest: RoutesManifest): Promise<SpecLock> {
  const lock: SpecLock = {
    routesHash: computeHash(manifest),
    updatedAt: new Date().toISOString(),
  };

  await Bun.write(lockPath, JSON.stringify(lock, null, 2));
  return lock;
}

export async function verifyLock(
  lockPath: string,
  manifest: RoutesManifest
): Promise<{ valid: boolean; currentHash: string; lockHash: string | null }> {
  const currentHash = computeHash(manifest);
  const lock = await readLock(lockPath);

  if (!lock) {
    return { valid: false, currentHash, lockHash: null };
  }

  return {
    valid: lock.routesHash === currentHash,
    currentHash,
    lockHash: lock.routesHash,
  };
}
