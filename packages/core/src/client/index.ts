/**
 * Mandu Client Module 🏝️
 * 클라이언트 사이드 hydration 및 라우팅을 위한 API
 *
 * @example
 * ```typescript
 * // Island 컴포넌트
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
 * // Client-side 라우팅
 * import { Link, useRouter } from "@mandujs/core/client";
 *
 * function Nav() {
 *   const { pathname, navigate } = useRouter();
 *   return <Link href="/about">About</Link>;
 * }
 * ```
 */

// Island API
export {
  island,
  wrapComponent,
  useServerData,
  useHydrated,
  useIslandEvent,
  fetchApi,
  type IslandDefinition,
  type IslandMetadata,
  type CompiledIsland,
  type FetchOptions,
  type WrapComponentOptions,
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

// Client-side Router API
export {
  navigate,
  prefetch,
  subscribe,
  getRouterState,
  getCurrentRoute,
  getLoaderData,
  getNavigationState,
  initializeRouter,
  cleanupRouter,
  type RouteInfo,
  type NavigationState,
  type RouterState,
  type NavigateOptions,
} from "./router";

// Link Components
export { Link, NavLink, type LinkProps, type NavLinkProps } from "./Link";

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
} from "./hooks";

// Props Serialization (Fresh 스타일)
export {
  serializeProps,
  deserializeProps,
  isSerializable,
  generatePropsScript,
  parsePropsScript,
} from "./serialize";

// Re-export as Mandu namespace for consistent API
import { island, wrapComponent } from "./island";
import { navigate, prefetch, initializeRouter } from "./router";
import { Link, NavLink } from "./Link";

/**
 * Mandu Client namespace
 * v0.8.0: Hydration은 자동으로 처리됨 (generateRuntimeSource에서 생성)
 */
export const Mandu = {
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
};
