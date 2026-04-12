/**
 * CLI Lifecycle Hook System
 *
 * Lightweight hook runner for build/dev/start lifecycle events.
 * Hooks defined in mandu.config.ts run first, then plugin hooks
 * in registration order. Each hook is isolated -- one failure
 * does not block subsequent hooks.
 */

export interface ManduHooks {
  onBeforeBuild?: () => void | Promise<void>;
  onAfterBuild?: (result: { success: boolean; duration: number }) => void | Promise<void>;
  onDevStart?: (info: { port: number; hostname: string }) => void | Promise<void>;
  onDevStop?: () => void | Promise<void>;
  onRouteChange?: (info: { routeId: string; pattern: string; kind: string }) => void | Promise<void>;
  onBeforeStart?: () => void | Promise<void>;
}

export interface ManduPlugin {
  name: string;
  hooks?: Partial<ManduHooks>;
  setup?: (config: Record<string, unknown>) => void | Promise<void>;
}

/**
 * Run a named lifecycle hook across config-level hooks and plugins.
 *
 * Execution order:
 *   1. Config hook (from mandu.config.ts `hooks` field)
 *   2. Plugin hooks (from `plugins[].hooks`, in array order)
 *
 * Each invocation is wrapped in try/catch so a single failing hook
 * does not prevent the remaining hooks from executing.
 */
export async function runHook<K extends keyof ManduHooks>(
  hookName: K,
  plugins: ManduPlugin[],
  configHooks: Partial<ManduHooks> | undefined,
  ...args: Parameters<NonNullable<ManduHooks[K]>>
): Promise<void> {
  const invoke = async (
    label: string,
    fn: ((...a: unknown[]) => void | Promise<void>) | undefined,
  ) => {
    if (!fn) return;
    try {
      await fn(...args);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[plugin] ${hookName} failed in ${label}: ${msg}`);
    }
  };

  // Config-level hook runs first
  await invoke("config", configHooks?.[hookName] as ((...a: unknown[]) => void | Promise<void>) | undefined);

  // Plugin hooks run in registration order
  for (const plugin of plugins) {
    await invoke(
      plugin.name,
      plugin.hooks?.[hookName] as ((...a: unknown[]) => void | Promise<void>) | undefined,
    );
  }
}
