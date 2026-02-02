/**
 * Mandu SEO - Twitter Card Meta Tags Rendering
 */

import type { ResolvedMetadata } from '../types'
import { urlToString } from '../resolve/url'

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
 * Twitter 메타 태그 생성 헬퍼
 */
function twitter(name: string, content: string | number): string {
  return `<meta name="twitter:${name}" content="${escapeHtml(String(content))}" />`
}

/**
 * Twitter Card 메타 태그 렌더링
 */
export function renderTwitter(metadata: ResolvedMetadata): string {
  const tw = metadata.twitter
  if (!tw) return ''

  const tags: string[] = []

  // Card type
  tags.push(twitter('card', tw.card))

  // Site
  if (tw.site) {
    tags.push(twitter('site', tw.site))
  }
  if (tw.siteId) {
    tags.push(twitter('site:id', tw.siteId))
  }

  // Creator
  if (tw.creator) {
    tags.push(twitter('creator', tw.creator))
  }
  if (tw.creatorId) {
    tags.push(twitter('creator:id', tw.creatorId))
  }

  // Title - fallback to OG or metadata title
  const title = tw.title || metadata.openGraph?.title || metadata.title?.absolute
  if (title) {
    tags.push(twitter('title', title))
  }

  // Description - fallback to OG or metadata description
  const description = tw.description || metadata.openGraph?.description || metadata.description
  if (description) {
    tags.push(twitter('description', description))
  }

  // Images
  if (tw.images) {
    for (let i = 0; i < tw.images.length; i++) {
      const image = tw.images[i]
      if (i === 0) {
        tags.push(twitter('image', urlToString(image.url)))
        if (image.alt) {
          tags.push(twitter('image:alt', image.alt))
        }
      } else {
        // Multiple images (for galleries)
        tags.push(twitter(`image${i}`, urlToString(image.url)))
        if (image.alt) {
          tags.push(twitter(`image${i}:alt`, image.alt))
        }
      }
    }
  }

  // Player card
  if (tw.players) {
    for (const player of tw.players) {
      tags.push(twitter('player', String(player.playerUrl)))
      if (player.streamUrl) {
        tags.push(twitter('player:stream', String(player.streamUrl)))
      }
      tags.push(twitter('player:width', player.width))
      tags.push(twitter('player:height', player.height))
    }
  }

  // App card
  if (tw.app) {
    if (tw.app.name) {
      tags.push(twitter('app:name:iphone', tw.app.name))
      tags.push(twitter('app:name:ipad', tw.app.name))
      tags.push(twitter('app:name:googleplay', tw.app.name))
    }
    if (tw.app.id?.iphone) {
      tags.push(twitter('app:id:iphone', String(tw.app.id.iphone)))
    }
    if (tw.app.id?.ipad) {
      tags.push(twitter('app:id:ipad', String(tw.app.id.ipad)))
    }
    if (tw.app.id?.googleplay) {
      tags.push(twitter('app:id:googleplay', tw.app.id.googleplay))
    }
    if (tw.app.url?.iphone) {
      tags.push(twitter('app:url:iphone', String(tw.app.url.iphone)))
    }
    if (tw.app.url?.ipad) {
      tags.push(twitter('app:url:ipad', String(tw.app.url.ipad)))
    }
    if (tw.app.url?.googleplay) {
      tags.push(twitter('app:url:googleplay', String(tw.app.url.googleplay)))
    }
  }

  return tags.join('\n')
}
