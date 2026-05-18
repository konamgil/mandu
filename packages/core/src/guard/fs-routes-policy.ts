import type { FSRoutesGuardConfig } from "./types";

export const DEFAULT_FS_ROUTES_GUARD_POLICY: FSRoutesGuardConfig = {
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

function clonePolicy(policy: FSRoutesGuardConfig): FSRoutesGuardConfig {
  return {
    noPageToPage: policy.noPageToPage,
    pageCanImport: policy.pageCanImport ? [...policy.pageCanImport] : undefined,
    layoutCanImport: policy.layoutCanImport ? [...policy.layoutCanImport] : undefined,
    routeCanImport: policy.routeCanImport ? [...policy.routeCanImport] : undefined,
  };
}

export function getDefaultFsRoutesGuardPolicy(
  enabled: boolean
): FSRoutesGuardConfig | undefined {
  return enabled ? clonePolicy(DEFAULT_FS_ROUTES_GUARD_POLICY) : undefined;
}
