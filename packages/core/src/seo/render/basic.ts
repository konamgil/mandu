/**
 * Mandu SEO - Basic Meta Tags Rendering
 *
 * title, description, robots 등 기본 메타 태그 렌더링
 */

import type { ResolvedMetadata } from '../types'
import { urlToString } from '../resolve/url'

/**
 * 메타 태그 생성 헬퍼
 */
function meta(name: string, content: string): string {
  const escapedContent = escapeHtml(content)
  return `<meta name="${name}" content="${escapedContent}" />`
}

/**
 * property 메타 태그 생성 헬퍼 (Open Graph용)
 */
function metaProperty(property: string, content: string): string {
  const escapedContent = escapeHtml(content)
  return `<meta property="${property}" content="${escapedContent}" />`
}

/**
 * HTML 이스케이프
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * <title> 태그 렌더링
 */
export function renderTitle(metadata: ResolvedMetadata): string {
  const title = metadata.title?.absolute
  if (!title) return ''
  return `<title>${escapeHtml(title)}</title>`
}

/**
 * 기본 메타 태그 렌더링
 */
export function renderBasicMeta(metadata: ResolvedMetadata): string {
  const tags: string[] = []

  // description
  if (metadata.description) {
    tags.push(meta('description', metadata.description))
  }

  // application-name
  if (metadata.applicationName) {
    tags.push(meta('application-name', metadata.applicationName))
  }

  // author
  if (metadata.authors) {
    for (const author of metadata.authors) {
      if (author.name) {
        tags.push(meta('author', author.name))
      }
      if (author.url) {
        const url = typeof author.url === 'string' ? author.url : author.url.href
        tags.push(`<link rel="author" href="${escapeHtml(url)}" />`)
      }
    }
  }

  // generator
  if (metadata.generator) {
    tags.push(meta('generator', metadata.generator))
  }

  // keywords
  if (metadata.keywords && metadata.keywords.length > 0) {
    tags.push(meta('keywords', metadata.keywords.join(', ')))
  }

  // referrer
  if (metadata.referrer) {
    tags.push(meta('referrer', metadata.referrer))
  }

  // creator
  if (metadata.creator) {
    tags.push(meta('creator', metadata.creator))
  }

  // publisher
  if (metadata.publisher) {
    tags.push(meta('publisher', metadata.publisher))
  }

  // robots
  if (metadata.robots?.basic) {
    tags.push(meta('robots', metadata.robots.basic))
  }
  if (metadata.robots?.googleBot) {
    tags.push(meta('googlebot', metadata.robots.googleBot))
  }

  // category
  if (metadata.category) {
    tags.push(meta('category', metadata.category))
  }

  // classification
  if (metadata.classification) {
    tags.push(meta('classification', metadata.classification))
  }

  return tags.join('\n')
}

/**
 * Verification 메타 태그 렌더링
 */
export function renderVerification(metadata: ResolvedMetadata): string {
  const verification = metadata.verification
  if (!verification) return ''

  const tags: string[] = []

  if (verification.google) {
    for (const value of verification.google) {
      tags.push(meta('google-site-verification', value))
    }
  }

  if (verification.yahoo) {
    for (const value of verification.yahoo) {
      tags.push(meta('y_key', value))
    }
  }

  if (verification.yandex) {
    for (const value of verification.yandex) {
      tags.push(meta('yandex-verification', value))
    }
  }

  if (verification.me) {
    for (const value of verification.me) {
      tags.push(meta('me', value))
    }
  }

  if (verification.other) {
    for (const [name, values] of Object.entries(verification.other)) {
      for (const value of values) {
        tags.push(meta(name, value))
      }
    }
  }

  return tags.join('\n')
}

/**
 * Canonical & Alternates 렌더링
 */
export function renderAlternates(metadata: ResolvedMetadata): string {
  const alternates = metadata.alternates
  if (!alternates) return ''

  const tags: string[] = []

  // canonical
  if (alternates.canonical) {
    tags.push(`<link rel="canonical" href="${escapeHtml(alternates.canonical.href)}" />`)
  }

  // languages (hreflang)
  if (alternates.languages) {
    for (const [lang, url] of Object.entries(alternates.languages)) {
      tags.push(`<link rel="alternate" hreflang="${lang}" href="${escapeHtml(url.href)}" />`)
    }
  }

  // media alternates
  if (alternates.media) {
    for (const [media, url] of Object.entries(alternates.media)) {
      tags.push(`<link rel="alternate" media="${escapeHtml(media)}" href="${escapeHtml(url.href)}" />`)
    }
  }

  // type alternates
  if (alternates.types) {
    for (const [type, url] of Object.entries(alternates.types)) {
      tags.push(`<link rel="alternate" type="${escapeHtml(type)}" href="${escapeHtml(url.href)}" />`)
    }
  }

  return tags.join('\n')
}

/**
 * Icons 렌더링
 */
export function renderIcons(metadata: ResolvedMetadata): string {
  const icons = metadata.icons
  if (!icons) return ''

  const tags: string[] = []

  // icon
  for (const icon of icons.icon) {
    const iconUrl = urlToString(icon.url)
    if (!iconUrl) continue
    const attrs = [`rel="icon"`, `href="${escapeHtml(iconUrl)}"`]
    if (icon.type) attrs.push(`type="${escapeHtml(icon.type)}"`)
    if (icon.sizes) attrs.push(`sizes="${escapeHtml(icon.sizes)}"`)
    tags.push(`<link ${attrs.join(' ')} />`)
  }

  // apple-touch-icon
  for (const icon of icons.apple) {
    const iconUrl = urlToString(icon.url)
    if (!iconUrl) continue
    const attrs = [`rel="apple-touch-icon"`, `href="${escapeHtml(iconUrl)}"`]
    if (icon.sizes) attrs.push(`sizes="${escapeHtml(icon.sizes)}"`)
    tags.push(`<link ${attrs.join(' ')} />`)
  }

  // shortcut icon
  for (const icon of icons.shortcut) {
    const iconUrl = urlToString(icon.url)
    if (!iconUrl) continue
    tags.push(`<link rel="shortcut icon" href="${escapeHtml(iconUrl)}" />`)
  }

  // other icons
  for (const icon of icons.other) {
    const iconUrl = urlToString(icon.url)
    if (!iconUrl) continue
    const attrs = [`href="${escapeHtml(iconUrl)}"`]
    if (icon.rel) attrs.push(`rel="${escapeHtml(icon.rel)}"`)
    if (icon.type) attrs.push(`type="${escapeHtml(icon.type)}"`)
    if (icon.sizes) attrs.push(`sizes="${escapeHtml(icon.sizes)}"`)
    if (icon.color) attrs.push(`color="${escapeHtml(icon.color)}"`)
    if (icon.media) attrs.push(`media="${escapeHtml(icon.media)}"`)
    tags.push(`<link ${attrs.join(' ')} />`)
  }

  return tags.join('\n')
}

/**
 * Manifest 렌더링
 */
export function renderManifest(metadata: ResolvedMetadata): string {
  if (!metadata.manifest) return ''
  return `<link rel="manifest" href="${escapeHtml(metadata.manifest.href)}" />`
}

/**
 * Other custom meta tags 렌더링
 */
export function renderOther(metadata: ResolvedMetadata): string {
  if (!metadata.other) return ''

  const tags: string[] = []

  for (const [name, value] of Object.entries(metadata.other)) {
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      tags.push(meta(name, String(v)))
    }
  }

  return tags.join('\n')
}

// ============================================================================
// Google SEO 최적화 렌더링
// ============================================================================

/**
 * Google 전용 메타 태그 렌더링
 */
export function renderGoogle(metadata: ResolvedMetadata): string {
  const google = metadata.google
  if (!google) return ''

  const tags: string[] = []

  if (google.nositelinkssearchbox) {
    tags.push(meta('google', 'nositelinkssearchbox'))
  }
  if (google.notranslate) {
    tags.push(meta('google', 'notranslate'))
  }

  return tags.join('\n')
}

/**
 * Format Detection 메타 태그 렌더링
 */
export function renderFormatDetection(metadata: ResolvedMetadata): string {
  const fd = metadata.formatDetection
  if (!fd) return ''

  const values: string[] = []

  if (fd.telephone === false) values.push('telephone=no')
  if (fd.date === false) values.push('date=no')
  if (fd.address === false) values.push('address=no')
  if (fd.email === false) values.push('email=no')

  if (values.length === 0) return ''
  return meta('format-detection', values.join(', '))
}

/**
 * Theme Color 메타 태그 렌더링
 */
export function renderThemeColor(metadata: ResolvedMetadata): string {
  const themeColor = metadata.themeColor
  if (!themeColor || themeColor.length === 0) return ''

  const tags: string[] = []

  for (const tc of themeColor) {
    if (tc.media) {
      tags.push(`<meta name="theme-color" content="${escapeHtml(tc.color)}" media="${escapeHtml(tc.media)}" />`)
    } else {
      tags.push(`<meta name="theme-color" content="${escapeHtml(tc.color)}" />`)
    }
  }

  return tags.join('\n')
}

/**
 * Viewport 메타 태그 렌더링
 */
export function renderViewport(metadata: ResolvedMetadata): string {
  if (!metadata.viewport) return ''
  return meta('viewport', metadata.viewport)
}

/**
 * Resource Hints 렌더링 (preconnect, dns-prefetch, preload)
 */
export function renderResourceHints(metadata: ResolvedMetadata): string {
  const hints = metadata.resourceHints
  if (!hints) return ''

  const tags: string[] = []

  // dns-prefetch
  if (hints.dnsPrefetch) {
    for (const url of hints.dnsPrefetch) {
      tags.push(`<link rel="dns-prefetch" href="${escapeHtml(url)}" />`)
    }
  }

  // preconnect
  if (hints.preconnect) {
    for (const url of hints.preconnect) {
      tags.push(`<link rel="preconnect" href="${escapeHtml(url)}" crossorigin />`)
    }
  }

  // preload
  if (hints.preload) {
    for (const resource of hints.preload) {
      const attrs = [
        `rel="preload"`,
        `href="${escapeHtml(resource.href)}"`,
        `as="${resource.as}"`,
      ]
      if (resource.type) {
        attrs.push(`type="${escapeHtml(resource.type)}"`)
      }
      if (resource.crossOrigin) {
        attrs.push(`crossorigin="${resource.crossOrigin}"`)
      }
      tags.push(`<link ${attrs.join(' ')} />`)
    }
  }

  // prefetch
  if (hints.prefetch) {
    for (const url of hints.prefetch) {
      tags.push(`<link rel="prefetch" href="${escapeHtml(url)}" />`)
    }
  }

  return tags.join('\n')
}

/**
 * App Links 메타 태그 렌더링 (iOS/Android 앱 연동)
 */
export function renderAppLinks(metadata: ResolvedMetadata): string {
  const al = metadata.appLinks
  if (!al) return ''

  const tags: string[] = []

  // iOS
  if (al.iosAppStoreId) {
    tags.push(meta('apple-itunes-app', `app-id=${al.iosAppStoreId}`))
  }

  // Android
  if (al.androidPackage) {
    tags.push(metaProperty('al:android:package', al.androidPackage))
  }
  if (al.androidAppName) {
    tags.push(metaProperty('al:android:app_name', al.androidAppName))
  }
  if (al.androidUrl) {
    tags.push(metaProperty('al:android:url', al.androidUrl))
  }

  // iOS App Links
  if (al.iosAppName) {
    tags.push(metaProperty('al:ios:app_name', al.iosAppName))
  }
  if (al.iosUrl) {
    tags.push(metaProperty('al:ios:url', al.iosUrl))
  }

  return tags.join('\n')
}
