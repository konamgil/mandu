/**
 * Mandu Island - 선언적 Islands Architecture
 *
 * @example
 * ```tsx
 * import { island } from '@mandujs/core';
 *
 * export default island('visible', ({ name }) => {
 *   const [count, setCount] = useState(0);
 *   return <button onClick={() => setCount(c => c + 1)}>{name}: {count}</button>;
 * });
 * ```
 */

import type { ComponentType, ReactNode } from 'react';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

/** 하이드레이션 타이밍 */
export type IslandHydrationStrategy =
  | 'load'      // 페이지 로드 즉시
  | 'idle'      // requestIdleCallback
  | 'visible'   // IntersectionObserver
  | 'media'     // 미디어 쿼리 매치 시
  | 'never';    // SSR only, 하이드레이션 안 함

/** Island 옵션 */
export interface IslandOptions<P = unknown> {
  /** 하이드레이션 전략 */
  hydrate: IslandHydrationStrategy;
  /** 미디어 쿼리 (hydrate: 'media' 일 때) */
  media?: string;
  /** SSR 폴백 컴포넌트 */
  fallback?: ReactNode;
  /** Props 스키마 (Zod) - 런타임 검증 */
  props?: z.ZodType<P>;
  /** Island 이름 (자동 생성됨) */
  name?: string;
}

/** Island 컴포넌트 메타데이터 */
export interface IslandMeta {
  __island: true;
  __hydrate: IslandHydrationStrategy;
  __media?: string;
  __fallback?: ReactNode;
  __name: string;
  __propsSchema?: z.ZodType<unknown>;
}

/** Island 컴포넌트 타입 */
export type IslandComponent<P = unknown> = ComponentType<P> & IslandMeta;

// ============================================================================
// Island Registry (서버/클라이언트 공용)
// ============================================================================

const islandRegistry = new Map<string, IslandComponent<any>>();
let islandCounter = 0;

export function registerIsland(name: string, component: IslandComponent<any>): void {
  islandRegistry.set(name, component);
}

export function getIsland(name: string): IslandComponent<any> | undefined {
  return islandRegistry.get(name);
}

export function getAllIslands(): Map<string, IslandComponent<any>> {
  return islandRegistry;
}

// ============================================================================
// island() - 선언적 Island 생성
// ============================================================================

/**
 * 선언적 Island 컴포넌트 생성
 *
 * @example
 * // 간단한 사용
 * export default island('visible', ({ name }) => <div>{name}</div>);
 *
 * @example
 * // 옵션과 함께
 * export default island({
 *   hydrate: 'idle',
 *   fallback: <Skeleton />,
 *   props: z.object({ userId: z.string() }),
 * }, ({ userId }) => {
 *   // ...
 * });
 */
export function island<P extends Record<string, unknown>>(
  strategy: IslandHydrationStrategy,
  Component: ComponentType<P>
): IslandComponent<P>;

export function island<P extends Record<string, unknown>>(
  options: IslandOptions<P>,
  Component: ComponentType<P>
): IslandComponent<P>;

export function island<P extends Record<string, unknown>>(
  strategyOrOptions: IslandHydrationStrategy | IslandOptions<P>,
  Component: ComponentType<P>
): IslandComponent<P> {
  const options: IslandOptions<P> = typeof strategyOrOptions === 'string'
    ? { hydrate: strategyOrOptions }
    : strategyOrOptions;

  const name = options.name || `island_${++islandCounter}_${Component.name || 'Anonymous'}`;

  // Island 메타데이터 부착
  const IslandWrapper = Component as IslandComponent<P>;
  IslandWrapper.__island = true;
  IslandWrapper.__hydrate = options.hydrate;
  IslandWrapper.__media = options.media;
  IslandWrapper.__fallback = options.fallback;
  IslandWrapper.__name = name;
  IslandWrapper.__propsSchema = options.props;

  // 레지스트리에 등록
  registerIsland(name, IslandWrapper);

  return IslandWrapper;
}

// ============================================================================
// isIsland() - Island 컴포넌트 체크
// ============================================================================

export function isIsland(component: unknown): component is IslandComponent<unknown> {
  return (
    typeof component === 'function' &&
    (component as IslandComponent<unknown>).__island === true
  );
}

// ============================================================================
// serializeIslandProps() - Props 직렬화
// ============================================================================

export function serializeIslandProps(props: Record<string, unknown>): string {
  return JSON.stringify(props, (_, value) => {
    // Date 처리
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    // Map 처리
    if (value instanceof Map) {
      return { __type: 'Map', value: Array.from(value.entries()) };
    }
    // Set 처리
    if (value instanceof Set) {
      return { __type: 'Set', value: Array.from(value) };
    }
    // 함수는 직렬화 불가
    if (typeof value === 'function') {
      console.warn('[Mandu Island] Functions cannot be serialized as props');
      return undefined;
    }
    return value;
  });
}

// ============================================================================
// deserializeIslandProps() - Props 역직렬화
// ============================================================================

export function deserializeIslandProps(json: string): Record<string, unknown> {
  return JSON.parse(json, (_, value) => {
    if (value && typeof value === 'object' && '__type' in value) {
      switch (value.__type) {
        case 'Date':
          return new Date(value.value);
        case 'Map':
          return new Map(value.value);
        case 'Set':
          return new Set(value.value);
      }
    }
    return value;
  });
}

// ============================================================================
// createIslandPlaceholder() - SSR용 플레이스홀더 생성
// ============================================================================

export interface IslandPlaceholderProps {
  name: string;
  props: Record<string, unknown>;
  hydrate: IslandHydrationStrategy;
  media?: string;
  fallback?: ReactNode;
}

export function createIslandPlaceholder({
  name,
  props,
  hydrate,
  media,
  fallback,
}: IslandPlaceholderProps): string {
  const serializedProps = serializeIslandProps(props);
  const fallbackHtml = fallback ? renderFallback(fallback) : '<div class="mandu-island-loading">Loading...</div>';

  return `<div data-mandu-island="${name}" data-hydrate="${hydrate}"${media ? ` data-media="${media}"` : ''} data-props='${escapeHtml(serializedProps)}'>${fallbackHtml}</div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderFallback(fallback: ReactNode): string {
  // 간단한 fallback 처리 (실제로는 react-dom/server 사용)
  if (typeof fallback === 'string') return fallback;
  if (fallback === null || fallback === undefined) return '';
  return '<div class="mandu-island-loading">Loading...</div>';
}

// ============================================================================
// Client Hydration Script
// ============================================================================

export const ISLAND_HYDRATION_SCRIPT = `
<script type="module">
(function() {
  const strategies = {
    load: (el, hydrate) => hydrate(),
    idle: (el, hydrate) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(hydrate);
      } else {
        setTimeout(hydrate, 200);
      }
    },
    visible: (el, hydrate) => {
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          hydrate();
        }
      });
      observer.observe(el);
    },
    media: (el, hydrate, query) => {
      const mql = window.matchMedia(query);
      if (mql.matches) {
        hydrate();
      } else {
        mql.addEventListener('change', (e) => {
          if (e.matches) hydrate();
        }, { once: true });
      }
    },
    never: () => {},
  };

  window.__MANDU_HYDRATE_ISLAND__ = async function(el, Component) {
    const strategy = el.dataset.hydrate || 'load';
    const media = el.dataset.media;
    const props = JSON.parse(el.dataset.props || '{}');

    const doHydrate = async () => {
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(el);
      root.render(window.React.createElement(Component, props));
      el.dataset.hydrated = 'true';
      console.log('[Mandu] Island hydrated:', el.dataset.manduIsland);
    };

    if (strategy === 'media' && media) {
      strategies.media(el, doHydrate, media);
    } else {
      strategies[strategy]?.(el, doHydrate);
    }
  };

  // Auto-discover and hydrate islands
  document.querySelectorAll('[data-mandu-island]').forEach(el => {
    const name = el.dataset.manduIsland;
    if (window.__MANDU_ISLANDS__?.[name]) {
      window.__MANDU_HYDRATE_ISLAND__(el, window.__MANDU_ISLANDS__[name]);
    }
  });
})();
</script>
`;

// ============================================================================
// Exports
// ============================================================================

export type { ComponentType, ReactNode };
