/**
 * Mandu SEO - URL Resolution
 *
 * 상대 URL을 metadataBase 기준 절대 URL로 변환
 */

/**
 * metadataBase를 URL 객체로 정규화
 */
export function normalizeMetadataBase(
  metadataBase: string | URL | null | undefined
): URL | null {
  if (!metadataBase) return null

  if (metadataBase instanceof URL) {
    return metadataBase
  }

  try {
    return new URL(metadataBase)
  } catch {
    console.warn(`[Mandu SEO] Invalid metadataBase: ${metadataBase}`)
    return null
  }
}

/**
 * 상대 URL을 절대 URL로 변환
 */
export function resolveUrl(url: URL, metadataBase: URL | null): URL;
export function resolveUrl(url: string | null | undefined, metadataBase: URL | null): URL | null;
export function resolveUrl(url: string | URL | null | undefined, metadataBase: URL | null): URL | null;
export function resolveUrl(
  url: string | URL | null | undefined,
  metadataBase: URL | null
): URL | null {
  if (!url) return null

  // 이미 URL 객체
  if (url instanceof URL) {
    return url
  }

  // 이미 절대 URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      return new URL(url)
    } catch {
      return null
    }
  }

  // 상대 URL - metadataBase 필요
  if (!metadataBase) {
    // metadataBase 없이 상대 URL 사용 시 경고
    if (url.startsWith('/')) {
      console.warn(
        `[Mandu SEO] Relative URL "${url}" requires metadataBase to be set. ` +
        `Add metadataBase to your root layout's metadata.`
      )
    }
    return null
  }

  try {
    return new URL(url, metadataBase)
  } catch {
    return null
  }
}

/**
 * URL을 문자열로 변환 (렌더링용)
 */
export function urlToString(url: URL): string;
export function urlToString(url: string): string;
export function urlToString(url: null | undefined): null;
export function urlToString(url: URL | string | null | undefined): string | null;
export function urlToString(url: URL | string | null | undefined): string | null {
  if (!url) return null
  if (url instanceof URL) return url.href
  return url
}

/**
 * 배열의 URL들을 모두 절대 URL로 변환
 */
export function resolveUrls<T extends { url: string | URL }>(
  items: T[] | null | undefined,
  metadataBase: URL | null
): (T & { url: URL })[] | null {
  if (!items || items.length === 0) return null

  const resolved: (T & { url: URL })[] = []

  for (const item of items) {
    const resolvedUrl = resolveUrl(item.url, metadataBase)
    if (resolvedUrl) {
      resolved.push({ ...item, url: resolvedUrl })
    }
  }

  return resolved.length > 0 ? resolved : null
}
