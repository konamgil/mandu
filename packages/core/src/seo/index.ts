/**
 * Mandu SEO Module
 *
 * Next.js Metadata API 패턴 기반의 SEO 지원
 *
 * @example
 * ```typescript
 * // app/layout.tsx - 정적 메타데이터
 * import type { Metadata } from '@mandujs/core'
 *
 * export const metadata: Metadata = {
 *   metadataBase: new URL('https://example.com'),
 *   title: {
 *     template: '%s | My Site',
 *     default: 'My Site',
 *   },
 *   description: 'Welcome to my site',
 *   openGraph: {
 *     siteName: 'My Site',
 *     type: 'website',
 *   },
 * }
 * ```
 *
 * @example
 * ```typescript
 * // app/blog/[slug]/page.tsx - 동적 메타데이터
 * import type { Metadata, MetadataParams } from '@mandujs/core'
 *
 * export async function generateMetadata({ params }: MetadataParams): Promise<Metadata> {
 *   const post = await getPost(params.slug)
 *   return {
 *     title: post.title,
 *     description: post.excerpt,
 *     openGraph: {
 *       title: post.title,
 *       images: [post.coverImage],
 *     },
 *   }
 * }
 * ```
 */

// Types
export type {
  // Main types
  Metadata,
  ResolvedMetadata,
  MetadataItem,
  MetadataParams,
  GenerateMetadata,

  // Title types
  Title,
  TemplateString,
  AbsoluteString,
  AbsoluteTemplateString,

  // Basic types
  Author,
  ReferrerEnum,
  ColorSchemeEnum,
  Robots,
  ResolvedRobots,

  // Icons
  Icon,
  IconURL,
  IconDescriptor,
  Icons,
  ResolvedIcons,

  // Alternates
  AlternateURLs,
  ResolvedAlternateURLs,
  Languages,

  // Verification
  Verification,
  ResolvedVerification,

  // Open Graph
  OpenGraph,
  OpenGraphType,
  OpenGraphImage,
  OpenGraphVideo,
  OpenGraphAudio,
  OpenGraphArticle,
  OpenGraphProfile,
  OpenGraphBook,
  ResolvedOpenGraph,

  // Twitter
  Twitter,
  TwitterCardType,
  TwitterImage,
  TwitterPlayer,
  TwitterApp,
  ResolvedTwitter,

  // JSON-LD
  JsonLd,
  JsonLdType,

  // Google SEO 최적화
  GoogleMeta,
  FormatDetection,
  ResourceHint,
  AppLinks,
  ThemeColor,

  // Metadata Routes
  Sitemap,
  SitemapEntry,
  RobotsFile,
  RobotsRule,
  MetadataRoute,
} from './types'

// Resolve functions
export {
  resolveMetadata,
  mergeMetadata,
  createDefaultMetadata,
  resolveTitle,
  extractTitleTemplate,
  normalizeMetadataBase,
  resolveUrl,
  urlToString,
  resolveRobots,
  resolveOpenGraph,
  resolveTwitter,
} from './resolve'

// Render functions
export {
  renderMetadata,
  renderTitle,
  renderBasicMeta,
  renderVerification,
  renderAlternates,
  renderIcons,
  renderManifest,
  renderOther,
  renderOpenGraph,
  renderTwitter,
  renderJsonLd,
  // JSON-LD helpers
  createArticleJsonLd,
  createWebSiteJsonLd,
  createOrganizationJsonLd,
  createBreadcrumbJsonLd,
  createFAQJsonLd,
  createProductJsonLd,
  createLocalBusinessJsonLd,
  createVideoJsonLd,
  createReviewJsonLd,
  createCourseJsonLd,
  createEventJsonLd,
  createSoftwareAppJsonLd,
  // Google SEO 최적화 렌더링
  renderGoogle,
  renderFormatDetection,
  renderThemeColor,
  renderViewport,
  renderResourceHints,
  renderAppLinks,
  // Metadata Routes rendering
  renderSitemap,
  renderSitemapIndex,
  renderRobots,
  createDefaultRobots,
  createDevRobots,
} from './render'

// Metadata Routes (sitemap.ts, robots.ts)
export {
  createSitemapHandler,
  createRobotsHandler,
  createSitemapIndexHandler,
  buildMetadataRoutes,
  getMetadataRouteType,
  createMetadataRouteInfo,
  createDynamicSitemapRouteInfo,
  METADATA_ROUTE_PATTERNS,
} from './routes'

export type {
  SitemapFunction,
  RobotsFunction,
  MetadataRouteModule,
  MetadataRouteHandler,
  MetadataRouteConfig,
  DiscoveredRoutes,
  MetadataRouteDefinition,
} from './routes'

// SSR Integration
export {
  resolveSEO,
  resolveSEOSync,
  injectSEOIntoOptions,
  layoutEntriesToMetadataItems,
  metadataToProps,
  generateHeadUpdateScript,
} from './integration/ssr'

export type {
  SEOOptions,
  SEOResult,
  LayoutMetadataEntry,
  SEOContextValue,
  StreamingSSRWithSEOOptions,
} from './integration/ssr'
