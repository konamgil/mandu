/**
 * Mandu SEO - Metadata Routes
 *
 * sitemap.ts, robots.ts 파일 컨벤션을 라우트로 변환
 *
 * @example
 * ```typescript
 * // app/sitemap.ts
 * import type { MetadataRoute } from '@mandujs/core'
 *
 * export default function sitemap(): MetadataRoute.Sitemap {
 *   return [
 *     { url: 'https://example.com', lastModified: new Date(), priority: 1.0 },
 *     { url: 'https://example.com/about', changeFrequency: 'monthly' },
 *   ]
 * }
 * ```
 *
 * @example
 * ```typescript
 * // app/robots.ts
 * import type { MetadataRoute } from '@mandujs/core'
 *
 * export default function robots(): MetadataRoute.Robots {
 *   return {
 *     rules: { userAgent: '*', allow: '/', disallow: '/admin' },
 *     sitemap: 'https://example.com/sitemap.xml',
 *   }
 * }
 * ```
 */

import type { Sitemap, RobotsFile } from '../types'
import { renderSitemap, renderSitemapIndex } from '../render/sitemap'
import { renderRobots } from '../render/robots'

// ============================================================================
// Types
// ============================================================================

export type SitemapFunction = () => Sitemap | Promise<Sitemap>
export type RobotsFunction = () => RobotsFile | Promise<RobotsFile>

export interface MetadataRouteModule {
  default: SitemapFunction | RobotsFunction
}

export interface MetadataRouteHandler {
  path: string
  contentType: string
  handler: () => Promise<string>
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * sitemap.ts 모듈에서 라우트 핸들러 생성
 *
 * @param sitemapFn - sitemap 함수 (default export)
 * @returns Request handler
 */
export function createSitemapHandler(sitemapFn: SitemapFunction): () => Promise<Response> {
  return async () => {
    try {
      const sitemap = await sitemapFn()
      const xml = renderSitemap(sitemap)

      return new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        },
      })
    } catch (error) {
      console.error('[Mandu SEO] Sitemap generation failed:', error)
      return new Response('<!-- Sitemap generation error -->', {
        status: 500,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      })
    }
  }
}

/**
 * robots.ts 모듈에서 라우트 핸들러 생성
 *
 * @param robotsFn - robots 함수 (default export)
 * @returns Request handler
 */
export function createRobotsHandler(robotsFn: RobotsFunction): () => Promise<Response> {
  return async () => {
    try {
      const robots = await robotsFn()
      const txt = renderRobots(robots)

      return new Response(txt, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        },
      })
    } catch (error) {
      console.error('[Mandu SEO] Robots.txt generation failed:', error)
      return new Response('# Robots.txt generation error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
  }
}

/**
 * sitemap index 핸들러 생성 (대규모 사이트용)
 *
 * @param sitemapUrls - 개별 sitemap URL 목록
 * @returns Request handler
 */
export function createSitemapIndexHandler(
  sitemapUrls: Array<{ url: string; lastModified?: string | Date }>
): () => Promise<Response> {
  return async () => {
    try {
      const xml = renderSitemapIndex(sitemapUrls)

      return new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        },
      })
    } catch (error) {
      console.error('[Mandu SEO] Sitemap index generation failed:', error)
      return new Response('<!-- Sitemap index generation error -->', {
        status: 500,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      })
    }
  }
}

// ============================================================================
// Route Discovery
// ============================================================================

export interface MetadataRouteConfig {
  /** app 디렉토리 경로 */
  appDir: string
  /** 베이스 URL (sitemap의 절대 URL 생성용) */
  baseUrl?: string
}

export interface DiscoveredRoutes {
  sitemap?: MetadataRouteHandler
  robots?: MetadataRouteHandler
  dynamicSitemaps?: MetadataRouteHandler[]
}

/**
 * 메타데이터 라우트 파일 패턴
 */
export const METADATA_ROUTE_PATTERNS = {
  sitemap: /^sitemap\.(ts|tsx|js|jsx)$/,
  dynamicSitemap: /^sitemap\[([^\]]+)\]\.(ts|tsx|js|jsx)$/,
  robots: /^robots\.(ts|tsx|js|jsx)$/,
} as const

/**
 * 파일 경로에서 라우트 타입 결정
 */
export function getMetadataRouteType(
  filename: string
): 'sitemap' | 'dynamicSitemap' | 'robots' | null {
  if (METADATA_ROUTE_PATTERNS.sitemap.test(filename)) {
    return 'sitemap'
  }
  if (METADATA_ROUTE_PATTERNS.dynamicSitemap.test(filename)) {
    return 'dynamicSitemap'
  }
  if (METADATA_ROUTE_PATTERNS.robots.test(filename)) {
    return 'robots'
  }
  return null
}

/**
 * 메타데이터 라우트 정보 생성
 */
export function createMetadataRouteInfo(
  type: 'sitemap' | 'robots',
  modulePath: string
): {
  path: string
  contentType: string
  modulePath: string
} {
  switch (type) {
    case 'sitemap':
      return {
        path: '/sitemap.xml',
        contentType: 'application/xml',
        modulePath,
      }
    case 'robots':
      return {
        path: '/robots.txt',
        contentType: 'text/plain',
        modulePath,
      }
  }
}

/**
 * 동적 sitemap 라우트 정보 생성
 *
 * @example
 * sitemap[id].ts → /sitemap/0.xml, /sitemap/1.xml, ...
 */
export function createDynamicSitemapRouteInfo(
  filename: string,
  modulePath: string
): {
  paramName: string
  pathPattern: string
  contentType: string
  modulePath: string
} | null {
  const match = filename.match(METADATA_ROUTE_PATTERNS.dynamicSitemap)
  if (!match) return null

  const paramName = match[1]

  return {
    paramName,
    pathPattern: `/sitemap/:${paramName}.xml`,
    contentType: 'application/xml',
    modulePath,
  }
}

// ============================================================================
// Integration with Router
// ============================================================================

export interface MetadataRouteDefinition {
  path: string
  method: 'GET'
  handler: () => Promise<Response>
}

/**
 * 메타데이터 라우트를 라우터에 등록할 수 있는 형태로 변환
 *
 * @example
 * ```typescript
 * import sitemap from './app/sitemap'
 * import robots from './app/robots'
 *
 * const routes = buildMetadataRoutes({ sitemap, robots })
 * // → [
 * //   { path: '/sitemap.xml', method: 'GET', handler: ... },
 * //   { path: '/robots.txt', method: 'GET', handler: ... },
 * // ]
 * ```
 */
export function buildMetadataRoutes(modules: {
  sitemap?: SitemapFunction
  robots?: RobotsFunction
}): MetadataRouteDefinition[] {
  const routes: MetadataRouteDefinition[] = []

  if (modules.sitemap) {
    routes.push({
      path: '/sitemap.xml',
      method: 'GET',
      handler: createSitemapHandler(modules.sitemap),
    })
  }

  if (modules.robots) {
    routes.push({
      path: '/robots.txt',
      method: 'GET',
      handler: createRobotsHandler(modules.robots),
    })
  }

  return routes
}
