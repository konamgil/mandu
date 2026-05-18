import { getDefaultFsRoutesGuardPolicy, type GuardConfig } from "@mandujs/core";

type FsRoutesPolicy = NonNullable<GuardConfig["fsRoutes"]>;

export function getFsRoutesGuardPolicy(enabled: boolean): FsRoutesPolicy | undefined {
  return getDefaultFsRoutesGuardPolicy(enabled);
}
