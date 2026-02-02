/**
 * Mandu SEO - JSON-LD Rendering
 *
 * 구조화된 데이터 (Schema.org)
 */

import type { ResolvedMetadata, JsonLd } from '../types'

/**
 * JSON-LD script 태그 렌더링
 */
export function renderJsonLd(metadata: ResolvedMetadata): string {
  if (!metadata.jsonLd || metadata.jsonLd.length === 0) return ''

  const tags: string[] = []

  for (const data of metadata.jsonLd) {
    const json = JSON.stringify(data, null, 0)
    tags.push(`<script type="application/ld+json">${json}</script>`)
  }

  return tags.join('\n')
}

// ============================================================================
// JSON-LD Helpers
// ============================================================================

/**
 * Article JSON-LD 생성 헬퍼
 */
export function createArticleJsonLd(options: {
  headline: string
  description?: string
  author: string | { name: string; url?: string }
  datePublished: Date | string
  dateModified?: Date | string
  image?: string | string[]
  publisher?: {
    name: string
    logo?: string
  }
}): JsonLd {
  const author = typeof options.author === 'string'
    ? { '@type': 'Person', name: options.author }
    : { '@type': 'Person', name: options.author.name, url: options.author.url }

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: options.headline,
    description: options.description,
    author,
    datePublished: options.datePublished instanceof Date
      ? options.datePublished.toISOString()
      : options.datePublished,
    dateModified: options.dateModified instanceof Date
      ? options.dateModified.toISOString()
      : options.dateModified,
    image: options.image,
    publisher: options.publisher
      ? {
          '@type': 'Organization',
          name: options.publisher.name,
          logo: options.publisher.logo
            ? { '@type': 'ImageObject', url: options.publisher.logo }
            : undefined,
        }
      : undefined,
  }
}

/**
 * WebSite JSON-LD 생성 헬퍼
 */
export function createWebSiteJsonLd(options: {
  name: string
  url: string
  description?: string
  potentialAction?: {
    searchUrl: string
    queryInput: string
  }
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: options.name,
    url: options.url,
    description: options.description,
    potentialAction: options.potentialAction
      ? {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: options.potentialAction.searchUrl,
          },
          'query-input': options.potentialAction.queryInput,
        }
      : undefined,
  }
}

/**
 * Organization JSON-LD 생성 헬퍼
 */
export function createOrganizationJsonLd(options: {
  name: string
  url: string
  logo?: string
  description?: string
  sameAs?: string[]
  contactPoint?: {
    telephone?: string
    contactType?: string
    email?: string
  }
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: options.name,
    url: options.url,
    logo: options.logo,
    description: options.description,
    sameAs: options.sameAs,
    contactPoint: options.contactPoint
      ? {
          '@type': 'ContactPoint',
          ...options.contactPoint,
        }
      : undefined,
  }
}

/**
 * BreadcrumbList JSON-LD 생성 헬퍼
 */
export function createBreadcrumbJsonLd(
  items: Array<{ name: string; url: string }>
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

/**
 * FAQPage JSON-LD 생성 헬퍼
 */
export function createFAQJsonLd(
  questions: Array<{ question: string; answer: string }>
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(q => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  }
}

/**
 * Product JSON-LD 생성 헬퍼
 */
export function createProductJsonLd(options: {
  name: string
  description?: string
  image?: string | string[]
  brand?: string
  sku?: string
  offers?: {
    price: number
    priceCurrency: string
    availability?: 'InStock' | 'OutOfStock' | 'PreOrder'
    url?: string
  }
  aggregateRating?: {
    ratingValue: number
    reviewCount: number
  }
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: options.name,
    description: options.description,
    image: options.image,
    brand: options.brand
      ? { '@type': 'Brand', name: options.brand }
      : undefined,
    sku: options.sku,
    offers: options.offers
      ? {
          '@type': 'Offer',
          price: options.offers.price,
          priceCurrency: options.offers.priceCurrency,
          availability: options.offers.availability
            ? `https://schema.org/${options.offers.availability}`
            : undefined,
          url: options.offers.url,
        }
      : undefined,
    aggregateRating: options.aggregateRating
      ? {
          '@type': 'AggregateRating',
          ratingValue: options.aggregateRating.ratingValue,
          reviewCount: options.aggregateRating.reviewCount,
        }
      : undefined,
  }
}

/**
 * LocalBusiness JSON-LD 생성 헬퍼 (지역 비즈니스)
 */
export function createLocalBusinessJsonLd(options: {
  name: string
  description?: string
  url?: string
  telephone?: string
  email?: string
  address: {
    streetAddress: string
    addressLocality: string
    addressRegion?: string
    postalCode: string
    addressCountry: string
  }
  geo?: {
    latitude: number
    longitude: number
  }
  openingHours?: string[]
  priceRange?: string
  image?: string | string[]
  aggregateRating?: {
    ratingValue: number
    reviewCount: number
  }
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: options.name,
    description: options.description,
    url: options.url,
    telephone: options.telephone,
    email: options.email,
    address: {
      '@type': 'PostalAddress',
      ...options.address,
    },
    geo: options.geo
      ? {
          '@type': 'GeoCoordinates',
          latitude: options.geo.latitude,
          longitude: options.geo.longitude,
        }
      : undefined,
    openingHoursSpecification: options.openingHours,
    priceRange: options.priceRange,
    image: options.image,
    aggregateRating: options.aggregateRating
      ? {
          '@type': 'AggregateRating',
          ratingValue: options.aggregateRating.ratingValue,
          reviewCount: options.aggregateRating.reviewCount,
        }
      : undefined,
  }
}

/**
 * VideoObject JSON-LD 생성 헬퍼
 */
export function createVideoJsonLd(options: {
  name: string
  description: string
  thumbnailUrl: string | string[]
  uploadDate: Date | string
  duration?: string  // ISO 8601 format (e.g., "PT1M30S")
  contentUrl?: string
  embedUrl?: string
  interactionCount?: number
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: options.name,
    description: options.description,
    thumbnailUrl: options.thumbnailUrl,
    uploadDate: options.uploadDate instanceof Date
      ? options.uploadDate.toISOString()
      : options.uploadDate,
    duration: options.duration,
    contentUrl: options.contentUrl,
    embedUrl: options.embedUrl,
    interactionStatistic: options.interactionCount
      ? {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'WatchAction' },
          userInteractionCount: options.interactionCount,
        }
      : undefined,
  }
}

/**
 * Review JSON-LD 생성 헬퍼
 */
export function createReviewJsonLd(options: {
  itemReviewed: {
    type: string
    name: string
  }
  author: string | { name: string; url?: string }
  reviewRating: {
    ratingValue: number
    bestRating?: number
    worstRating?: number
  }
  reviewBody?: string
  datePublished?: Date | string
}): JsonLd {
  const author = typeof options.author === 'string'
    ? { '@type': 'Person', name: options.author }
    : { '@type': 'Person', name: options.author.name, url: options.author.url }

  return {
    '@context': 'https://schema.org',
    '@type': 'Review',
    itemReviewed: {
      '@type': options.itemReviewed.type,
      name: options.itemReviewed.name,
    },
    author,
    reviewRating: {
      '@type': 'Rating',
      ratingValue: options.reviewRating.ratingValue,
      bestRating: options.reviewRating.bestRating || 5,
      worstRating: options.reviewRating.worstRating || 1,
    },
    reviewBody: options.reviewBody,
    datePublished: options.datePublished instanceof Date
      ? options.datePublished.toISOString()
      : options.datePublished,
  }
}

/**
 * Course JSON-LD 생성 헬퍼 (교육 콘텐츠)
 */
export function createCourseJsonLd(options: {
  name: string
  description: string
  provider: {
    name: string
    url?: string
  }
  url?: string
  image?: string
  aggregateRating?: {
    ratingValue: number
    reviewCount: number
  }
  offers?: {
    price: number
    priceCurrency: string
  }
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: options.name,
    description: options.description,
    provider: {
      '@type': 'Organization',
      name: options.provider.name,
      url: options.provider.url,
    },
    url: options.url,
    image: options.image,
    aggregateRating: options.aggregateRating
      ? {
          '@type': 'AggregateRating',
          ratingValue: options.aggregateRating.ratingValue,
          reviewCount: options.aggregateRating.reviewCount,
        }
      : undefined,
    offers: options.offers
      ? {
          '@type': 'Offer',
          price: options.offers.price,
          priceCurrency: options.offers.priceCurrency,
        }
      : undefined,
  }
}

/**
 * Event JSON-LD 생성 헬퍼
 */
export function createEventJsonLd(options: {
  name: string
  description?: string
  startDate: Date | string
  endDate?: Date | string
  location: {
    name: string
    address: string
  } | {
    type: 'VirtualLocation'
    url: string
  }
  image?: string
  organizer?: {
    name: string
    url?: string
  }
  offers?: {
    price: number
    priceCurrency: string
    availability?: 'InStock' | 'SoldOut' | 'PreOrder'
    validFrom?: Date | string
    url?: string
  }
  eventStatus?: 'EventScheduled' | 'EventCancelled' | 'EventPostponed' | 'EventRescheduled'
  eventAttendanceMode?: 'OfflineEventAttendanceMode' | 'OnlineEventAttendanceMode' | 'MixedEventAttendanceMode'
}): JsonLd {
  const location = 'type' in options.location && options.location.type === 'VirtualLocation'
    ? {
        '@type': 'VirtualLocation',
        url: options.location.url,
      }
    : {
        '@type': 'Place',
        name: (options.location as { name: string; address: string }).name,
        address: (options.location as { name: string; address: string }).address,
      }

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: options.name,
    description: options.description,
    startDate: options.startDate instanceof Date
      ? options.startDate.toISOString()
      : options.startDate,
    endDate: options.endDate instanceof Date
      ? options.endDate.toISOString()
      : options.endDate,
    location,
    image: options.image,
    organizer: options.organizer
      ? {
          '@type': 'Organization',
          name: options.organizer.name,
          url: options.organizer.url,
        }
      : undefined,
    offers: options.offers
      ? {
          '@type': 'Offer',
          price: options.offers.price,
          priceCurrency: options.offers.priceCurrency,
          availability: options.offers.availability
            ? `https://schema.org/${options.offers.availability}`
            : undefined,
          validFrom: options.offers.validFrom instanceof Date
            ? options.offers.validFrom.toISOString()
            : options.offers.validFrom,
          url: options.offers.url,
        }
      : undefined,
    eventStatus: options.eventStatus
      ? `https://schema.org/${options.eventStatus}`
      : undefined,
    eventAttendanceMode: options.eventAttendanceMode
      ? `https://schema.org/${options.eventAttendanceMode}`
      : undefined,
  }
}

/**
 * SoftwareApplication JSON-LD 생성 헬퍼
 */
export function createSoftwareAppJsonLd(options: {
  name: string
  description?: string
  applicationCategory?: string
  operatingSystem?: string
  offers?: {
    price: number
    priceCurrency: string
  }
  aggregateRating?: {
    ratingValue: number
    ratingCount: number
  }
  downloadUrl?: string
  screenshot?: string | string[]
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: options.name,
    description: options.description,
    applicationCategory: options.applicationCategory,
    operatingSystem: options.operatingSystem,
    offers: options.offers
      ? {
          '@type': 'Offer',
          price: options.offers.price,
          priceCurrency: options.offers.priceCurrency,
        }
      : undefined,
    aggregateRating: options.aggregateRating
      ? {
          '@type': 'AggregateRating',
          ratingValue: options.aggregateRating.ratingValue,
          ratingCount: options.aggregateRating.ratingCount,
        }
      : undefined,
    downloadUrl: options.downloadUrl,
    screenshot: options.screenshot,
  }
}
