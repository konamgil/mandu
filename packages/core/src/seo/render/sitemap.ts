/**
 * Mandu SEO - Sitemap XML Rendering
 *
 * Sitemap 배열을 XML 문자열로 변환
 */

import type { Sitemap, SitemapEntry } from '../types'

/**
 * XML 이스케이프
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Date를 ISO 문자열로 변환
 */
function formatDate(date: string | Date): string {
  if (date instanceof Date) {
    return date.toISOString()
  }
  return date
}

/**
 * 단일 sitemap 항목을 XML로 변환
 */
function renderSitemapEntry(entry: SitemapEntry): string {
  const lines: string[] = ['  <url>']

  lines.push(`    <loc>${escapeXml(entry.url)}</loc>`)

  if (entry.lastModified) {
    lines.push(`    <lastmod>${formatDate(entry.lastModified)}</lastmod>`)
  }

  if (entry.changeFrequency) {
    lines.push(`    <changefreq>${entry.changeFrequency}</changefreq>`)
  }

  if (entry.priority !== undefined) {
    lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`)
  }

  // 이미지 sitemap 확장
  if (entry.images && entry.images.length > 0) {
    for (const image of entry.images) {
      lines.push('    <image:image>')
      lines.push(`      <image:loc>${escapeXml(image)}</image:loc>`)
      lines.push('    </image:image>')
    }
  }

  // 다국어 alternate 링크 (xhtml:link)
  if (entry.alternates?.languages) {
    for (const [lang, url] of Object.entries(entry.alternates.languages)) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(url)}" />`)
    }
  }

  lines.push('  </url>')

  return lines.join('\n')
}

/**
 * Sitemap 배열을 XML 문자열로 렌더링
 *
 * @param sitemap - Sitemap 항목 배열
 * @returns XML 문자열
 *
 * @example
 * ```typescript
 * const xml = renderSitemap([
 *   { url: 'https://example.com', lastModified: new Date(), priority: 1.0 },
 *   { url: 'https://example.com/about', changeFrequency: 'monthly' },
 * ])
 * ```
 */
export function renderSitemap(sitemap: Sitemap): string {
  const hasImages = sitemap.some(entry => entry.images && entry.images.length > 0)
  const hasAlternates = sitemap.some(entry => entry.alternates?.languages)

  // XML 네임스페이스 구성
  const namespaces = ['xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"']

  if (hasImages) {
    namespaces.push('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')
  }

  if (hasAlternates) {
    namespaces.push('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset ${namespaces.join(' ')}>`,
    ...sitemap.map(renderSitemapEntry),
    '</urlset>',
  ]

  return lines.join('\n')
}

/**
 * Sitemap Index 렌더링 (대규모 사이트용)
 *
 * @param sitemaps - 개별 sitemap URL 배열
 * @returns XML 문자열
 */
export function renderSitemapIndex(
  sitemaps: Array<{ url: string; lastModified?: string | Date }>
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]

  for (const sitemap of sitemaps) {
    lines.push('  <sitemap>')
    lines.push(`    <loc>${escapeXml(sitemap.url)}</loc>`)
    if (sitemap.lastModified) {
      lines.push(`    <lastmod>${formatDate(sitemap.lastModified)}</lastmod>`)
    }
    lines.push('  </sitemap>')
  }

  lines.push('</sitemapindex>')

  return lines.join('\n')
}
