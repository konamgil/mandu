/**
 * Mandu SEO - Metadata Rendering
 *
 * ResolvedMetadata를 HTML 메타 태그 문자열로 변환
 */

import type { ResolvedMetadata } from '../types'
import {
  renderTitle,
  renderBasicMeta,
  renderVerification,
  renderAlternates,
  renderIcons,
  renderManifest,
  renderOther,
  renderGoogle,
  renderFormatDetection,
  renderThemeColor,
  renderViewport,
  renderResourceHints,
  renderAppLinks,
} from './basic'
import { renderOpenGraph } from './opengraph'
import { renderTwitter } from './twitter'
import { renderJsonLd } from './jsonld'

/**
 * 전체 메타데이터를 HTML 문자열로 렌더링
 *
 * @param metadata - 해석된 메타데이터
 * @returns HTML 문자열 (<head> 내부에 삽입할 내용)
 */
export function renderMetadata(metadata: ResolvedMetadata): string {
  const parts: string[] = []

  // Viewport (가장 먼저 - 모바일 렌더링 최적화)
  const viewport = renderViewport(metadata)
  if (viewport) parts.push(viewport)

  // Title
  const title = renderTitle(metadata)
  if (title) parts.push(title)

  // Basic meta tags
  const basic = renderBasicMeta(metadata)
  if (basic) parts.push(basic)

  // Theme Color (브라우저 UI)
  const themeColor = renderThemeColor(metadata)
  if (themeColor) parts.push(themeColor)

  // Google 전용 메타
  const google = renderGoogle(metadata)
  if (google) parts.push(google)

  // Format Detection (iOS Safari)
  const formatDetection = renderFormatDetection(metadata)
  if (formatDetection) parts.push(formatDetection)

  // Verification
  const verification = renderVerification(metadata)
  if (verification) parts.push(verification)

  // Alternates (canonical, hreflang)
  const alternates = renderAlternates(metadata)
  if (alternates) parts.push(alternates)

  // Icons
  const icons = renderIcons(metadata)
  if (icons) parts.push(icons)

  // Manifest
  const manifest = renderManifest(metadata)
  if (manifest) parts.push(manifest)

  // Resource Hints (preconnect, preload - 성능 최적화)
  const resourceHints = renderResourceHints(metadata)
  if (resourceHints) parts.push(resourceHints)

  // App Links (iOS/Android 앱 연동)
  const appLinks = renderAppLinks(metadata)
  if (appLinks) parts.push(appLinks)

  // Open Graph
  const openGraph = renderOpenGraph(metadata)
  if (openGraph) parts.push(openGraph)

  // Twitter
  const twitter = renderTwitter(metadata)
  if (twitter) parts.push(twitter)

  // JSON-LD
  const jsonLd = renderJsonLd(metadata)
  if (jsonLd) parts.push(jsonLd)

  // Other custom meta tags
  const other = renderOther(metadata)
  if (other) parts.push(other)

  return parts.join('\n')
}

/**
 * 개별 렌더 함수들도 export
 */
export {
  renderTitle,
  renderBasicMeta,
  renderVerification,
  renderAlternates,
  renderIcons,
  renderManifest,
  renderOther,
  // Google SEO 최적화
  renderGoogle,
  renderFormatDetection,
  renderThemeColor,
  renderViewport,
  renderResourceHints,
  renderAppLinks,
} from './basic'
export { renderOpenGraph } from './opengraph'
export { renderTwitter } from './twitter'
export {
  renderJsonLd,
  // JSON-LD 헬퍼 (Google 구조화 데이터)
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
} from './jsonld'

// Metadata Routes
export { renderSitemap, renderSitemapIndex } from './sitemap'
export { renderRobots, createDefaultRobots, createDevRobots } from './robots'
