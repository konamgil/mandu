/**
 * Mandu SEO - Twitter Card Resolution
 */

import type {
  Twitter,
  TwitterImage,
  ResolvedTwitter,
} from '../types'
import { resolveUrl } from './url'

/**
 * Twitter 이미지 배열로 정규화
 */
function resolveTwitterImages(
  images: Twitter['images'],
  metadataBase: URL | null
): TwitterImage[] | null {
  if (!images) return null

  const arr = Array.isArray(images) ? images : [images]
  const resolved: TwitterImage[] = []

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
          url: url.href,
          alt: image.alt,
        })
      }
    }
  }

  return resolved.length > 0 ? resolved : null
}

/**
 * Twitter Card 메타데이터 해석
 */
export function resolveTwitter(
  twitter: Twitter | null | undefined,
  metadataBase: URL | null
): ResolvedTwitter | null {
  if (!twitter) return null

  // 이미지가 있으면 기본 card는 summary_large_image
  const hasImages = twitter.images !== undefined
  const defaultCard = hasImages ? 'summary_large_image' : 'summary'

  return {
    card: twitter.card || defaultCard,
    site: twitter.site || null,
    siteId: twitter.siteId || null,
    creator: twitter.creator || null,
    creatorId: twitter.creatorId || null,
    title: twitter.title || null,
    description: twitter.description || null,
    images: resolveTwitterImages(twitter.images, metadataBase),
    players: twitter.players
      ? Array.isArray(twitter.players)
        ? twitter.players
        : [twitter.players]
      : null,
    app: twitter.app || null,
  }
}
