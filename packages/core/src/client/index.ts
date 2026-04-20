/**
 * Mandu Client Module
 * Client-side hydration and routing API
 *
 * @example
 * ```typescript
 * // Island component
 * import { Mandu } from "@mandujs/core/client";
 *
 * export default Mandu.island<TodosData>({
 *   setup: (data) => { ... },
 *   render: (props) => <TodoList {...props} />
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Client-side routing
 * import { Link, useRouter } from "@mandujs/core/client";
 *
 * function Nav() {
 *   const { pathname, navigate } = useRouter();
 *   return <Link href="/about">About</Link>;
 * }
 * ```
 */
import "./globals";

// Island API
export {
  island,
  wrapComponent,
  useServerData,
  useHydrated,
  useIslandEvent,
  fetchApi,
  // Partials/Slots API
  partial,
  slot,
  createPartialGroup,
  type IslandDefinition,
  type IslandMetadata,
  type CompiledIsland,
  type FetchOptions,
  type WrapComponentOptions,
  type IslandEventHandle,
  // Partials/Slots Types
  type PartialConfig,
  type PartialDefinition,
  type CompiledPartial,
  type SlotDefinition,
  type CompiledSlot,
  type PartialGroup,
} from "./island";

// Runtime API
export {
  getServerData,
  getHydrationState,
  unmountIsland,
  unmountAllIslands,
  type HydrationState,
  type HydrationPriority,
} from "./runtime";

// Phase 18.δ — Per-Island hydration scheduler (Astro-grade)
export {
  scheduleHydration,
  parseHydrateStrategy,
  VISIBLE_ROOT_MARGIN,
  INTERACTION_EVENTS,
  type HydrationStrategyName,
  type ParsedStrategy,
  type Disposer,
} from "./hydrate";

// SSE / ReadableStream API (microtask-starvation-safe)
export {
  useSSE,
  readStreamWithYield,
  type UseSSEOptions,
  type UseSSEReturn,
  type ReadStreamOptions,
} from "./use-sse";

// Client-side Router API
export {
  navigate,
  prefetch,
  subscribe,
  getRouterState,
  getCurrentRoute,
  getLoaderData,
  getActionData,
  getNavigationState,
  initializeRouter,
  cleanupRouter,
  submitAction,
  setShouldRevalidate,
  type RouteInfo,
  type NavigationState,
  type RouterState,
  type NavigateOptions,
  type ActionResult,
  type ShouldRevalidateFunction,
} from "./router";

// Link Components
export { Link, NavLink, type LinkProps, type NavLinkProps } from "./Link";

// Form Component (Progressive Enhancement)
export { Form, type FormProps, type FormState } from "./Form";

// RPC Client
export {
  createClient,
  RpcError,
  type RpcMethods,
  type RpcRequestOptions,
  type RpcClientOptions,
  // Phase 18.κ — typed RPC proxy
  createRpcClient,
  RpcCallError,
  type CreateRpcClientOptions,
} from "./rpc";

// useFetch Composable
export { useFetch, type UseFetchOptions, type UseFetchReturn } from "./use-fetch";

// Head Management
export { useHead, useSeoMeta, resetSSRHead, getSSRHeadTags, type HeadConfig, type SeoMetaConfig } from "./use-head";

// Stable interaction components
export { ManduButton, ManduModalTrigger } from "./interaction";

// Router Hooks
export {
  useRouter,
  useRoute,
  useParams,
  usePathname,
  useSearchParams,
  useLoaderData,
  useNavigation,
  useNavigate,
  useMatch,
  useGoBack,
  useGoForward,
  useRouterState,
  useActionData,
  useSubmit,
  useMandu,
} from "./hooks";

// Props Serialization (Fresh style)
export {
  serializeProps,
  deserializeProps,
  isSerializable,
  generatePropsScript,
  parsePropsScript,
} from "./serialize";

// Re-export as Mandu namespace for consistent API
import { island, wrapComponent, partial, slot, createPartialGroup } from "./island";
import { navigate, prefetch, initializeRouter } from "./router";
import { Link, NavLink } from "./Link";

/**
 * Mandu Client namespace
 * v0.8.0: Hydration is handled automatically (generateRuntimeSource)
 * Note: Use `ManduClient` to avoid conflict with other Mandu exports
 */
export const ManduClient = {
  /**
   * Create an island component
   * @see island
   */
  island,

  /**
   * Wrap existing React component as island
   * @see wrapComponent
   */
  wrapComponent,

  /**
   * Navigate to a URL (client-side)
   * @see navigate
   */
  navigate,

  /**
   * Prefetch a URL for faster navigation
   * @see prefetch
   */
  prefetch,

  /**
   * Initialize the client-side router
   * @see initializeRouter
   */
  initRouter: initializeRouter,

  /**
   * Link component for client-side navigation
   * @see Link
   */
  Link,

  /**
   * NavLink component with active state
   * @see NavLink
   */
  NavLink,

  /**
   * Create a partial island for granular hydration
   * @see partial
   */
  partial,

  /**
   * Create a slot for server-rendered content with client hydration
   * @see slot
   */
  slot,

  /**
   * Create a group of partials for coordinated hydration
   * @see createPartialGroup
   */
  createPartialGroup,
};
