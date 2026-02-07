/**
 * Mandu SEO - Open Graph Resolution
 */

import type {
  OpenGraph,
  OpenGraphImage,
  OpenGraphVideo,
  OpenGraphAudio,
  ResolvedOpenGraph,
} from '../types'
import { resolveUrl } from './url'

/**
 * OG 이미지 배열로 정규화
 */
function resolveOgImages(
  images: OpenGraph['images'],
  metadataBase: URL | null
): OpenGraphImage[] | null {
  if (!images) return null

  const arr = Array.isArray(images) ? images : [images]
  const resolved: OpenGraphImage[] = []

  for (const image of arr) {
    if (typeof image === 'string' || image instanceof URL) {
      const url = resolveUrl(image, metadataBase)
      if (url) {
        resolved.push({ url: url.href })
      }
    } else {
      const url = resolveUrl(image.url, metadataBase)
      if (url) {
        resolved.push({
          ...image,
          url: url.href,
          secureUrl: image.secureUrl
            ? resolveUrl(image.secureUrl, metadataBase)?.href
            : undefined,
        })
      }
    }
  }

  return resolved.length > 0 ? resolved : null
}

/**
 * OG 비디오 배열로 정규화
 */
function resolveOgVideos(
  videos: OpenGraph['videos'],
  metadataBase: URL | null
): OpenGraphVideo[] | null {
  if (!videos) return null

  const arr = Array.isArray(videos) ? videos : [videos]
  const resolved: OpenGraphVideo[] = []

  for (const video of arr) {
    if (typeof video === 'string' || video instanceof URL) {
      const url = resolveUrl(video, metadataBase)
      if (url) {
        resolved.push({ url: url.href })
      }
    } else {
      const url = resolveUrl(video.url, metadataBase)
      if (url) {
        resolved.push({
          ...video,
          url: url.href,
          secureUrl: video.secureUrl
            ? resolveUrl(video.secureUrl, metadataBase)?.href
            : undefined,
        })
      }
    }
  }

  return resolved.length > 0 ? resolved : null
}

/**
 * OG 오디오 배열로 정규화
 */
function resolveOgAudio(
  audio: OpenGraph['audio'],
  metadataBase: URL | null
): OpenGraphAudio[] | null {
  if (!audio) return null

  const arr = Array.isArray(audio) ? audio : [audio]
  const resolved: OpenGraphAudio[] = []

  for (const item of arr) {
    if (typeof item === 'string' || item instanceof URL) {
      const url = resolveUrl(item, metadataBase)
      if (url) {
        resolved.push({ url: url.href })
      }
    } else {
      const url = resolveUrl(item.url, metadataBase)
      if (url) {
        resolved.push({
          ...item,
          url: url.href,
          secureUrl: item.secureUrl
            ? resolveUrl(item.secureUrl, metadataBase)?.href
            : undefined,
        })
      }
    }
  }

  return resolved.length > 0 ? resolved : null
}

/**
 * Open Graph 메타데이터 해석
 */
export function resolveOpenGraph(
  openGraph: OpenGraph | null | undefined,
  metadataBase: URL | null
): ResolvedOpenGraph | null {
  if (!openGraph) return null

  return {
    type: openGraph.type || 'website',
    url: resolveUrl(openGraph.url, metadataBase),
    title: openGraph.title || null,
    description: openGraph.description || null,
    siteName: openGraph.siteName || null,
    locale: openGraph.locale || null,
    images: resolveOgImages(openGraph.images, metadataBase),
    videos: resolveOgVideos(openGraph.videos, metadataBase),
    audio: resolveOgAudio(openGraph.audio, metadataBase),
    determiner: openGraph.determiner || null,
    article: openGraph.article || null,
    profile: openGraph.profile || null,
    book: openGraph.book || null,
  }
}
