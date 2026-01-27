import { z } from "zod";

export const RouteKind = z.enum(["page", "api"]);
export type RouteKind = z.infer<typeof RouteKind>;

export const RouteSpec = z
  .object({
    id: z.string().min(1, "id는 필수입니다"),
    pattern: z.string().startsWith("/", "pattern은 /로 시작해야 합니다"),
    kind: RouteKind,
    module: z.string().min(1, "module 경로는 필수입니다"),
    componentModule: z.string().optional(),
    slotModule: z.string().optional(),
  })
  .refine(
    (route) => {
      if (route.kind === "page" && !route.componentModule) {
        return false;
      }
      return true;
    },
    {
      message: "kind가 'page'인 경우 componentModule은 필수입니다",
      path: ["componentModule"],
    }
  );

export type RouteSpec = z.infer<typeof RouteSpec>;

export const RoutesManifest = z
  .object({
    version: z.number().int().positive(),
    routes: z.array(RouteSpec),
  })
  .refine(
    (manifest) => {
      const ids = manifest.routes.map((r) => r.id);
      const uniqueIds = new Set(ids);
      return ids.length === uniqueIds.size;
    },
    {
      message: "route id는 중복될 수 없습니다",
      path: ["routes"],
    }
  )
  .refine(
    (manifest) => {
      const patterns = manifest.routes.map((r) => r.pattern);
      const uniquePatterns = new Set(patterns);
      return patterns.length === uniquePatterns.size;
    },
    {
      message: "route pattern은 중복될 수 없습니다",
      path: ["routes"],
    }
  );

export type RoutesManifest = z.infer<typeof RoutesManifest>;
