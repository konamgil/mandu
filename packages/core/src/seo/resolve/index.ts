/**
 * Mandu SEO - Metadata Resolution
 *
 * Layout 체인에서 메타데이터를 수집하고 병합
 */

import type {
  Metadata,
  ResolvedMetadata,
  MetadataItem,
  MetadataParams,
  Author,
  Icons,
  IconDescriptor,
  ResolvedIcons,
  Verification,
  ResolvedVerification,
  JsonLd,
  ThemeColor,
  ResourceHint,
  FormatDetection,
  GoogleMeta,
  AppLinks,
} from '../types'
import { resolveTitle, extractTitleTemplate } from './title'
import { normalizeMetadataBase, resolveUrl } from './url'
import { resolveRobots } from './robots'
import { resolveOpenGraph } from './opengraph'
import { resolveTwitter } from './twitter'

/**
 * 기본 메타데이터 생성
 */
export function createDefaultMetadata(): ResolvedMetadata {
  return {
    metadataBase: null,
    title: null,
    description: null,
    applicationName: null,
    authors: null,
    generator: 'Mandu',
    keywords: null,
    referrer: null,
    creator: null,
    publisher: null,
    robots: null,
    alternates: null,
    icons: null,
    manifest: null,
    openGraph: null,
    twitter: null,
    verification: null,
    category: null,
    classification: null,
    jsonLd: null,
    // Google SEO 최적화
    google: null,
    formatDetection: null,
    resourceHints: null,
    themeColor: null,
    viewport: null,
    appLinks: null,
    other: null,
  }
}

/**
 * Author 배열로 정규화
 */
function resolveAuthors(authors: Author | Author[] | null | undefined): Author[] | null {
  if (!authors) return null
  return Array.isArray(authors) ? authors : [authors]
}

/**
 * Keywords 배열로 정규화
 */
function resolveKeywords(keywords: string | string[] | null | undefined): string[] | null {
  if (!keywords) return null
  if (typeof keywords === 'string') {
    return keywords.split(',').map(k => k.trim())
  }
  return keywords
}

/**
 * Icons 해석
 */
function resolveIcons(icons: Metadata['icons'], metadataBase: URL | null): ResolvedIcons | null {
  if (!icons) return null

  const result: ResolvedIcons = {
    icon: [],
    apple: [],
    shortcut: [],
    other: [],
  }

  // 단순 문자열 URL
  if (typeof icons === 'string') {
    const url = resolveUrl(icons, metadataBase)
    if (url) {
      result.icon.push({ url: url.href })
    }
    return result
  }

  // 배열
  if (Array.isArray(icons)) {
    for (const icon of icons) {
      const descriptor = typeof icon === 'string'
        ? { url: icon }
        : icon instanceof URL
          ? { url: icon.href }
          : { ...icon, url: typeof icon.url === 'string' ? icon.url : icon.url.href }

      const resolvedUrl = resolveUrl(descriptor.url, metadataBase)
      if (resolvedUrl) {
        result.icon.push({ ...descriptor, url: resolvedUrl.href })
      }
    }
    return result
  }

  // Icons 객체
  const iconsObj = icons as Icons

  const processIconArray = (
    items: typeof iconsObj.icon,
    target: IconDescriptor[]
  ) => {
    if (!items) return
    const arr = Array.isArray(items) ? items : [items]
    for (const item of arr) {
      const descriptor = typeof item === 'string'
        ? { url: item }
        : item instanceof URL
          ? { url: item.href }
          : { ...item, url: typeof item.url === 'string' ? item.url : item.url.href }

      const resolvedUrl = resolveUrl(descriptor.url, metadataBase)
      if (resolvedUrl) {
        target.push({ ...descriptor, url: resolvedUrl.href })
      }
    }
  }

  processIconArray(iconsObj.icon, result.icon)
  processIconArray(iconsObj.apple, result.apple)
  processIconArray(iconsObj.shortcut, result.shortcut)

  if (iconsObj.other) {
    const others = Array.isArray(iconsObj.other) ? iconsObj.other : [iconsObj.other]
    for (const other of others) {
      const resolvedUrl = resolveUrl(other.url, metadataBase)
      if (resolvedUrl) {
        result.other.push({ ...other, url: resolvedUrl.href })
      }
    }
  }

  return result
}

/**
 * Verification 해석
 */
function resolveVerification(verification: Verification | null | undefined): ResolvedVerification | null {
  if (!verification) return null

  const toArray = (val: string | string[] | undefined): string[] | null => {
    if (!val) return null
    return Array.isArray(val) ? val : [val]
  }

  return {
    google: toArray(verification.google),
    yahoo: toArray(verification.yahoo),
    yandex: toArray(verification.yandex),
    me: toArray(verification.me),
    other: verification.other
      ? Object.fromEntries(
          Object.entries(verification.other).map(([k, v]) => [k, toArray(v)!])
        )
      : null,
  }
}

/**
 * JSON-LD 배열로 정규화
 */
function resolveJsonLd(jsonLd: JsonLd | JsonLd[] | null | undefined): JsonLd[] | null {
  if (!jsonLd) return null
  const arr = Array.isArray(jsonLd) ? jsonLd : [jsonLd]
  // @context 기본값 추가
  return arr.map(item => ({
    '@context': 'https://schema.org',
    ...item,
  }))
}

/**
 * Theme Color 배열로 정규화
 */
function resolveThemeColor(
  themeColor: string | ThemeColor | ThemeColor[] | null | undefined
): ThemeColor[] | null {
  if (!themeColor) return null
  if (typeof themeColor === 'string') {
    return [{ color: themeColor }]
  }
  return Array.isArray(themeColor) ? themeColor : [themeColor]
}

/**
 * Viewport 문자열로 정규화
 */
function resolveViewport(
  viewport: Metadata['viewport']
): string | null {
  if (!viewport) return null
  if (typeof viewport === 'string') return viewport

  const parts: string[] = []

  if (viewport.width !== undefined) {
    parts.push(`width=${viewport.width}`)
  }
  if (viewport.height !== undefined) {
    parts.push(`height=${viewport.height}`)
  }
  if (viewport.initialScale !== undefined) {
    parts.push(`initial-scale=${viewport.initialScale}`)
  }
  if (viewport.minimumScale !== undefined) {
    parts.push(`minimum-scale=${viewport.minimumScale}`)
  }
  if (viewport.maximumScale !== undefined) {
    parts.push(`maximum-scale=${viewport.maximumScale}`)
  }
  if (viewport.userScalable !== undefined) {
    parts.push(`user-scalable=${viewport.userScalable ? 'yes' : 'no'}`)
  }
  if (viewport.viewportFit !== undefined) {
    parts.push(`viewport-fit=${viewport.viewportFit}`)
  }

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * 두 메타데이터 객체 병합
 */
export function mergeMetadata(
  parent: ResolvedMetadata,
  child: Metadata
): ResolvedMetadata {
  const metadataBase = normalizeMetadataBase(child.metadataBase) || parent.metadataBase

  // 부모의 title template 추출
  const parentTemplate = parent.title?.template || null

  return {
    metadataBase,
    title: resolveTitle(child.title, parentTemplate) ?? parent.title,
    description: child.description ?? parent.description,
    applicationName: child.applicationName ?? parent.applicationName,
    authors: resolveAuthors(child.authors) ?? parent.authors,
    generator: child.generator ?? parent.generator,
    keywords: resolveKeywords(child.keywords) ?? parent.keywords,
    referrer: child.referrer ?? parent.referrer,
    creator: child.creator ?? parent.creator,
    publisher: child.publisher ?? parent.publisher,
    robots: resolveRobots(child.robots) ?? parent.robots,
    alternates: parent.alternates, // TODO: resolve alternates
    icons: resolveIcons(child.icons, metadataBase) ?? parent.icons,
    manifest: resolveUrl(child.manifest, metadataBase) ?? parent.manifest,
    openGraph: resolveOpenGraph(child.openGraph, metadataBase) ?? parent.openGraph,
    twitter: resolveTwitter(child.twitter, metadataBase) ?? parent.twitter,
    verification: resolveVerification(child.verification) ?? parent.verification,
    category: child.category ?? parent.category,
    classification: child.classification ?? parent.classification,
    jsonLd: resolveJsonLd(child.jsonLd) ?? parent.jsonLd,
    // Google SEO 최적화
    google: child.google ?? parent.google,
    formatDetection: child.formatDetection ?? parent.formatDetection,
    resourceHints: child.resourceHints ?? parent.resourceHints,
    themeColor: resolveThemeColor(child.themeColor) ?? parent.themeColor,
    viewport: resolveViewport(child.viewport) ?? parent.viewport,
    appLinks: child.appLinks ?? parent.appLinks,
    other: child.other ?? parent.other,
  }
}

/**
 * 메타데이터 항목 해석 (정적/동적)
 */
async function resolveMetadataItem(
  item: MetadataItem,
  params: MetadataParams,
  parentPromise: Promise<ResolvedMetadata>
): Promise<Metadata | null> {
  if (!item) return null

  // 정적 메타데이터
  if (typeof item !== 'function') {
    return item
  }

  // 동적 메타데이터 (generateMetadata)
  return await item(params, parentPromise)
}

/**
 * 전체 메타데이터 해석 파이프라인
 *
 * Layout 체인을 순회하며 메타데이터를 병합
 *
 * @param metadataItems - [rootLayout, ...nestedLayouts, page]
 * @param params - URL 파라미터
 * @param searchParams - 쿼리 파라미터
 */
export async function resolveMetadata(
  metadataItems: MetadataItem[],
  params: Record<string, string> = {},
  searchParams: Record<string, string> = {}
): Promise<ResolvedMetadata> {
  let resolved = createDefaultMetadata()

  for (const item of metadataItems) {
    // 현재 resolved를 Promise로 래핑 (generateMetadata의 parent 파라미터용)
    const parentPromise = Promise.resolve(resolved)

    const metadata = await resolveMetadataItem(
      item,
      { params, searchParams },
      parentPromise
    )

    if (metadata) {
      resolved = mergeMetadata(resolved, metadata)
    }
  }

  return resolved
}

// Re-export sub-modules
export { resolveTitle, extractTitleTemplate } from './title'
export { normalizeMetadataBase, resolveUrl, urlToString } from './url'
export { resolveRobots } from './robots'
export { resolveOpenGraph } from './opengraph'
export { resolveTwitter } from './twitter'
