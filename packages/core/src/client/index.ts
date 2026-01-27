/**
 * Mandu Client Module 🏝️
 * 클라이언트 사이드 hydration을 위한 API
 *
 * @example
 * ```typescript
 * // spec/slots/todos.client.ts
 * import { Mandu } from "@mandujs/core/client";
 *
 * export default Mandu.island<TodosData>({
 *   setup: (data) => { ... },
 *   render: (props) => <TodoList {...props} />
 * });
 * ```
 */

// Island API
export {
  island,
  useServerData,
  useHydrated,
  useIslandEvent,
  fetchApi,
  type IslandDefinition,
  type IslandMetadata,
  type CompiledIsland,
  type FetchOptions,
} from "./island";

// Runtime API
export {
  registerIsland,
  getRegisteredIslands,
  getServerData,
  hydrateIslands,
  getHydrationState,
  unmountIsland,
  unmountAllIslands,
  initializeRuntime,
  type IslandLoader,
} from "./runtime";

// Re-export as Mandu namespace for consistent API
import { island } from "./island";
import { hydrateIslands, initializeRuntime } from "./runtime";

/**
 * Mandu Client namespace
 */
export const Mandu = {
  /**
   * Create an island component
   * @see island
   */
  island,

  /**
   * Hydrate all islands on the page
   * @see hydrateIslands
   */
  hydrate: hydrateIslands,

  /**
   * Initialize the hydration runtime
   * @see initializeRuntime
   */
  init: initializeRuntime,
};
