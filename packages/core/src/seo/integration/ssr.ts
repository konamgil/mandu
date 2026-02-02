/**
 * Mandu SEO - SSR Integration
 *
 * Streaming SSR 파이프라인에 SEO 메타데이터 통합
 *
 * @example
 * ```typescript
 * // app/blog/[slug]/page.tsx
 * import { renderWithSEO } from '@mandujs/core'
 *
 * export default async function handler(req: Request) {
 *   const slug = getSlug(req)
 *   const post = await getPost(slug)
 *
 *   return renderWithSEO(<BlogPost post={post} />, {
 *     metadata: [
 *       layoutMetadata,  // from layout.tsx
 *       {
 *         title: post.title,
 *         description: post.excerpt,
 *         openGraph: { title: post.title, images: [post.image] },
 *       },
 *     ],
 *     routeParams: { slug },
 *   })
 * }
 * ```
 */

import type { ReactElement } from 'react'
import type { Metadata, MetadataItem, ResolvedMetadata } from '../types'
import { resolveMetadata, createDefaultMetadata } from '../resolve'
import { renderMetadata } from '../render'

// ============================================================================
// Types
// ============================================================================

export interface SEOOptions {
  /**
   * 메타데이터 항목들 (Layout 체인 순서)
   * [rootLayout, ...nestedLayouts, page]
   */
  metadata?: MetadataItem[]

  /**
   * 단일 정적 메타데이터 (간단한 경우)
   */
  staticMetadata?: Metadata

  /**
   * 라우트 파라미터 (동적 메타데이터용)
   */
  routeParams?: Record<string, string>

  /**
   * 쿼리 파라미터 (동적 메타데이터용)
   */
  searchParams?: Record<string, string>
}

export interface SEOResult {
  /** 해석된 메타데이터 */
  resolved: ResolvedMetadata
  /** 렌더링된 HTML 문자열 (<head> 내부) */
  html: string
  /** 페이지 타이틀 */
  title: string | null
}

// ============================================================================
// SEO Resolution
// ============================================================================

/**
 * SEO 메타데이터 해석 및 렌더링
 *
 * @param options - SEO 옵션
 * @returns 해석된 메타데이터와 HTML
 */
export async function resolveSEO(options: SEOOptions = {}): Promise<SEOResult> {
  const { metadata, staticMetadata, routeParams = {}, searchParams = {} } = options

  let resolved: ResolvedMetadata

  if (metadata && metadata.length > 0) {
    // Layout 체인에서 메타데이터 해석
    resolved = await resolveMetadata(metadata, routeParams, searchParams)
  } else if (staticMetadata) {
    // 단일 정적 메타데이터
    const base = createDefaultMetadata()
    resolved = await resolveMetadata([staticMetadata], routeParams, searchParams)
  } else {
    // 기본 메타데이터
    resolved = createDefaultMetadata()
  }

  // HTML 렌더링
  const html = renderMetadata(resolved)
  const title = resolved.title?.absolute || null

  return { resolved, html, title }
}

/**
 * 동기 버전 (정적 메타데이터 전용)
 *
 * 주의: 동기 버전은 간단한 메타데이터만 처리합니다.
 * 복잡한 메타데이터(OG, Twitter 등)는 resolveSEO를 사용하세요.
 */
export function resolveSEOSync(staticMetadata: Metadata): SEOResult {
  const base = createDefaultMetadata()

  // title 해석
  let resolvedTitle: { absolute: string; template: string | null } | null = null
  if (staticMetadata.title) {
    if (typeof staticMetadata.title === 'string') {
      resolvedTitle = { absolute: staticMetadata.title, template: null }
    } else if ('absolute' in staticMetadata.title) {
      resolvedTitle = {
        absolute: staticMetadata.title.absolute,
        template: staticMetadata.title.template || null,
      }
    } else if ('default' in staticMetadata.title) {
      resolvedTitle = {
        absolute: staticMetadata.title.default,
        template: staticMetadata.title.template || null,
      }
    }
  }

  // 간단한 병합 (동기)
  const resolved: ResolvedMetadata = {
    ...base,
    title: resolvedTitle,
    description: staticMetadata.description || null,
    keywords: staticMetadata.keywords
      ? typeof staticMetadata.keywords === 'string'
        ? staticMetadata.keywords.split(',').map(k => k.trim())
        : staticMetadata.keywords
      : null,
    robots: staticMetadata.robots
      ? typeof staticMetadata.robots === 'string'
        ? { basic: staticMetadata.robots, googleBot: null }
        : {
            basic: [
              staticMetadata.robots.index === false ? 'noindex' : 'index',
              staticMetadata.robots.follow === false ? 'nofollow' : 'follow',
            ].join(', '),
            googleBot: null,
          }
      : null,
  }

  const html = renderMetadata(resolved)
  const title = resolved.title?.absolute || null

  return { resolved, html, title }
}

// ============================================================================
// Streaming SSR Integration
// ============================================================================

/**
 * StreamingSSROptions에 추가할 SEO 확장 옵션
 */
export interface StreamingSSRWithSEOOptions {
  /** SEO 옵션 */
  seo?: SEOOptions
}

/**
 * Streaming SSR 옵션에 SEO headTags 주입
 *
 * @example
 * ```typescript
 * const baseOptions = { routeId: 'blog-post', isDev: true }
 * const seoOptions = { metadata: [layoutMeta, pageMeta] }
 *
 * const options = await injectSEOIntoOptions(baseOptions, seoOptions)
 * // → { ...baseOptions, title: 'Post Title', headTags: '<meta ...>' }
 * ```
 */
export async function injectSEOIntoOptions<T extends { title?: string; headTags?: string }>(
  options: T,
  seoOptions: SEOOptions
): Promise<T & { title: string; headTags: string }> {
  const { resolved, html, title } = await resolveSEO(seoOptions)

  // 기존 headTags와 병합
  const existingHeadTags = options.headTags || ''
  const mergedHeadTags = html + (existingHeadTags ? '\n' + existingHeadTags : '')

  return {
    ...options,
    title: title || options.title || 'Mandu App',
    headTags: mergedHeadTags,
  }
}

// ============================================================================
// Layout Chain Helpers
// ============================================================================

/**
 * 레이아웃 체인에서 메타데이터 수집
 *
 * @example
 * ```typescript
 * // 파일 시스템 기반 라우팅에서 사용
 * const chain = await collectLayoutMetadata([
 *   { path: 'app/layout.tsx', metadata: rootMeta },
 *   { path: 'app/blog/layout.tsx', metadata: blogMeta },
 *   { path: 'app/blog/[slug]/page.tsx', generateMetadata: generatePostMeta },
 * ])
 * ```
 */
export interface LayoutMetadataEntry {
  /** 레이아웃/페이지 경로 */
  path: string
  /** 정적 메타데이터 */
  metadata?: Metadata
  /** 동적 메타데이터 생성 함수 */
  generateMetadata?: (props: {
    params: Record<string, string>
    searchParams: Record<string, string>
  }) => Metadata | Promise<Metadata>
}

/**
 * 레이아웃 엔트리를 MetadataItem 배열로 변환
 */
export function layoutEntriesToMetadataItems(
  entries: LayoutMetadataEntry[]
): MetadataItem[] {
  return entries.map((entry) => {
    if (entry.generateMetadata) {
      return entry.generateMetadata
    }
    return entry.metadata || null
  })
}

// ============================================================================
// React Component Integration
// ============================================================================

/**
 * SEO Context 타입 (React Context 사용 시)
 */
export interface SEOContextValue {
  metadata: ResolvedMetadata
  updateMetadata: (partial: Partial<Metadata>) => void
}

/**
 * 메타데이터를 React 컴포넌트에서 사용할 수 있는 props로 변환
 */
export function metadataToProps(resolved: ResolvedMetadata): {
  title: string | null
  description: string | null
  ogImage: string | null
  ogUrl: string | null
} {
  return {
    title: resolved.title?.absolute || null,
    description: resolved.description || null,
    ogImage: resolved.openGraph?.images?.[0]?.url
      ? typeof resolved.openGraph.images[0].url === 'string'
        ? resolved.openGraph.images[0].url
        : resolved.openGraph.images[0].url.toString()
      : null,
    ogUrl: resolved.openGraph?.url?.href || null,
  }
}

// ============================================================================
// Head Component Support
// ============================================================================

/**
 * 동적 Head 업데이트를 위한 스크립트 생성
 * (클라이언트에서 document.title 등 업데이트)
 */
export function generateHeadUpdateScript(metadata: ResolvedMetadata): string {
  const updates: string[] = []

  // Title 업데이트
  if (metadata.title?.absolute) {
    updates.push(`document.title = ${JSON.stringify(metadata.title.absolute)};`)
  }

  // Description 업데이트
  if (metadata.description) {
    updates.push(`
      (function() {
        var meta = document.querySelector('meta[name="description"]');
        if (meta) meta.content = ${JSON.stringify(metadata.description)};
      })();
    `)
  }

  if (updates.length === 0) return ''

  return `<script>(function(){${updates.join('')}})()</script>`
}
