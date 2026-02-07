/**
 * Mandu SEO - Open Graph Meta Tags Rendering
 */

import type { ResolvedMetadata, ResolvedOpenGraph } from '../types'
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
 * OG 메타 태그 생성 헬퍼
 */
function og(property: string, content: string | number): string {
  return `<meta property="og:${property}" content="${escapeHtml(String(content))}" />`
}

/**
 * Open Graph 메타 태그 렌더링
 */
export function renderOpenGraph(metadata: ResolvedMetadata): string {
  const openGraph = metadata.openGraph
  if (!openGraph) return ''

  const tags: string[] = []

  // Basic OG tags
  if (openGraph.type) {
    tags.push(og('type', openGraph.type))
  }

  // title - fallback to metadata.title
  const title = openGraph.title || metadata.title?.absolute
  if (title) {
    tags.push(og('title', title))
  }

  // description - fallback to metadata.description
  const description = openGraph.description || metadata.description
  if (description) {
    tags.push(og('description', description))
  }

  if (openGraph.url) {
    tags.push(og('url', openGraph.url.href))
  }

  if (openGraph.siteName) {
    tags.push(og('site_name', openGraph.siteName))
  }

  if (openGraph.locale) {
    tags.push(og('locale', openGraph.locale))
  }

  if (openGraph.determiner) {
    tags.push(og('determiner', openGraph.determiner))
  }

  // Images
  if (openGraph.images) {
    for (const image of openGraph.images) {
      tags.push(og('image', urlToString(image.url)))
      if (image.secureUrl) {
        tags.push(og('image:secure_url', urlToString(image.secureUrl)))
      }
      if (image.type) {
        tags.push(og('image:type', image.type))
      }
      if (image.width) {
        tags.push(og('image:width', image.width))
      }
      if (image.height) {
        tags.push(og('image:height', image.height))
      }
      if (image.alt) {
        tags.push(og('image:alt', image.alt))
      }
    }
  }

  // Videos
  if (openGraph.videos) {
    for (const video of openGraph.videos) {
      tags.push(og('video', urlToString(video.url)))
      if (video.secureUrl) {
        tags.push(og('video:secure_url', urlToString(video.secureUrl)))
      }
      if (video.type) {
        tags.push(og('video:type', video.type))
      }
      if (video.width) {
        tags.push(og('video:width', video.width))
      }
      if (video.height) {
        tags.push(og('video:height', video.height))
      }
    }
  }

  // Audio
  if (openGraph.audio) {
    for (const audio of openGraph.audio) {
      tags.push(og('audio', urlToString(audio.url)))
      if (audio.secureUrl) {
        tags.push(og('audio:secure_url', urlToString(audio.secureUrl)))
      }
      if (audio.type) {
        tags.push(og('audio:type', audio.type))
      }
    }
  }

  // Article specific
  if (openGraph.article) {
    const article = openGraph.article
    if (article.publishedTime) {
      tags.push(og('article:published_time', article.publishedTime))
    }
    if (article.modifiedTime) {
      tags.push(og('article:modified_time', article.modifiedTime))
    }
    if (article.expirationTime) {
      tags.push(og('article:expiration_time', article.expirationTime))
    }
    if (article.section) {
      tags.push(og('article:section', article.section))
    }
    if (article.authors) {
      const authors = Array.isArray(article.authors) ? article.authors : [article.authors]
      for (const author of authors) {
        tags.push(og('article:author', author))
      }
    }
    if (article.tags) {
      for (const tag of article.tags) {
        tags.push(og('article:tag', tag))
      }
    }
  }

  // Profile specific
  if (openGraph.profile) {
    const profile = openGraph.profile
    if (profile.firstName) {
      tags.push(og('profile:first_name', profile.firstName))
    }
    if (profile.lastName) {
      tags.push(og('profile:last_name', profile.lastName))
    }
    if (profile.username) {
      tags.push(og('profile:username', profile.username))
    }
    if (profile.gender) {
      tags.push(og('profile:gender', profile.gender))
    }
  }

  // Book specific
  if (openGraph.book) {
    const book = openGraph.book
    if (book.isbn) {
      tags.push(og('book:isbn', book.isbn))
    }
    if (book.releaseDate) {
      tags.push(og('book:release_date', book.releaseDate))
    }
    if (book.authors) {
      const authors = Array.isArray(book.authors) ? book.authors : [book.authors]
      for (const author of authors) {
        tags.push(og('book:author', author))
      }
    }
    if (book.tags) {
      for (const tag of book.tags) {
        tags.push(og('book:tag', tag))
      }
    }
  }

  return tags.join('\n')
}
