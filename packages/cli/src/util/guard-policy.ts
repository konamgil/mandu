import type { GuardConfig } from "@mandujs/core";

type FsRoutesPolicy = NonNullable<GuardConfig["fsRoutes"]>;

const FS_ROUTES_POLICY: FsRoutesPolicy = {
  noPageToPage: true,
  pageCanImport: [
    "client/pages",
    "client/widgets",
    "client/features",
    "client/entities",
    "client/shared",
    "shared/contracts",
    "shared/types",
    "shared/utils/client",
  ],
  layoutCanImport: [
    "client/app",
    "client/widgets",
    "client/shared",
    "shared/contracts",
    "shared/types",
    "shared/utils/client",
  ],
  routeCanImport: [
    "server/api",
    "server/application",
    "server/domain",
    "server/infra",
    "server/core",
    "shared/contracts",
    "shared/schema",
    "shared/types",
    "shared/utils/client",
    "shared/utils/server",
    "shared/env",
  ],
};

export function getFsRoutesGuardPolicy(enabled: boolean): FsRoutesPolicy | undefined {
  return enabled ? FS_ROUTES_POLICY : undefined;
}
