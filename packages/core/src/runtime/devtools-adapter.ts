import type { RoutesManifest } from "../spec/schema";
import type { GuardConfig } from "../guard/types";
import {
  KITCHEN_PREFIX,
  KitchenHandler,
  recordRequest,
  type RequestEntry,
} from "../kitchen/kitchen-handler";

export type RuntimeKitchenHandler = KitchenHandler;

export interface RuntimeDevtoolsAdapter {
  readonly kitchen: RuntimeKitchenHandler | null;
  readonly dashboardPath: string | null;
  start(): void;
  stop(): void;
  updateManifest(manifest: RoutesManifest): void;
  handleRequest(req: Request, pathname: string): Promise<Response | null>;
}

export interface CreateRuntimeDevtoolsAdapterOptions {
  isDev: boolean;
  rootDir: string;
  manifest: RoutesManifest;
  guardConfig: GuardConfig | null;
}

export function createRuntimeDevtoolsAdapter(
  options: CreateRuntimeDevtoolsAdapterOptions
): RuntimeDevtoolsAdapter {
  const kitchen = options.isDev
    ? new KitchenHandler({
      rootDir: options.rootDir,
      manifest: options.manifest,
      guardConfig: options.guardConfig,
    })
    : null;

  return {
    kitchen,
    dashboardPath: kitchen ? KITCHEN_PREFIX : null,
    start() {
      if (kitchen) void kitchen.start();
    },
    stop() {
      kitchen?.stop();
    },
    updateManifest(manifest: RoutesManifest) {
      kitchen?.updateManifest(manifest);
    },
    async handleRequest(req: Request, pathname: string): Promise<Response | null> {
      if (!kitchen || !pathname.startsWith(KITCHEN_PREFIX)) return null;
      return await kitchen.handle(req, pathname);
    },
  };
}

export function shouldRecordRuntimeRequest(pathname: string): boolean {
  return (
    !pathname.startsWith("/.mandu/") &&
    !pathname.startsWith(KITCHEN_PREFIX) &&
    !pathname.startsWith("/__mandu/")
  );
}

export function recordRuntimeRequest(entry: RequestEntry): void {
  recordRequest(entry);
}
