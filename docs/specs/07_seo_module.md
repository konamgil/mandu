# Mandu SEO Module Specification

> Version: 1.0.0
> Status: Implemented (v0.9.35)
> Last Updated: 2026-02-02

---

## Overview

Mandu SEO Module provides comprehensive SEO support following the **Next.js Metadata API** pattern. This design choice ensures familiarity for developers coming from Next.js while providing enhanced features for search engine optimization.

### Key Features

| Feature | Description |
|---------|-------------|
| **Metadata API** | Next.js compatible static/dynamic metadata |
| **Layout Chain** | Metadata merging across layout hierarchy |
| **Open Graph** | Full OG protocol support |
| **Twitter Cards** | All card types (summary, large image, player, app) |
| **JSON-LD** | 12 structured data helpers (Schema.org) |
| **Sitemap** | XML sitemap generation with images/alternates |
| **Robots** | robots.txt generation |
| **Google SEO** | Viewport, theme-color, resource hints, app links |

---

## Architecture

```
packages/core/src/seo/
├── index.ts              # Public exports
├── types.ts              # Type definitions
├── resolve/              # Metadata resolution
│   ├── index.ts          # Main resolver
│   ├── title.ts          # Title template resolution
│   ├── url.ts            # URL normalization
│   ├── robots.ts         # Robots directive resolution
│   ├── opengraph.ts      # Open Graph resolution
│   └── twitter.ts        # Twitter Card resolution
├── render/               # HTML rendering
│   ├── index.ts          # Main renderer
│   ├── basic.ts          # Basic meta tags
│   ├── opengraph.ts      # Open Graph tags
│   ├── twitter.ts        # Twitter Card tags
│   ├── jsonld.ts         # JSON-LD scripts
│   ├── sitemap.ts        # Sitemap XML
│   └── robots.ts         # Robots.txt
├── routes/               # Route handlers
│   └── index.ts          # Sitemap/robots handlers
└── integration/          # Framework integration
    └── ssr.ts            # SSR integration
```

---

## Usage

### Static Metadata

```typescript
// app/layout.tsx
import type { Metadata } from '@mandujs/core'

export const metadata: Metadata = {
  metadataBase: new URL('https://example.com'),
  title: {
    template: '%s | My Site',
    default: 'My Site',
  },
  description: 'Welcome to my site',
  openGraph: {
    siteName: 'My Site',
    type: 'website',
  },
}
```

### Dynamic Metadata

```typescript
// app/blog/[slug]/page.tsx
import type { Metadata, MetadataParams } from '@mandujs/core'

export async function generateMetadata({ params }: MetadataParams): Promise<Metadata> {
  const post = await getPost(params.slug)

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      images: [post.coverImage],
    },
  }
}
```

### Title Templates

```typescript
// Root layout
export const metadata: Metadata = {
  title: {
    template: '%s | My Site',
    default: 'Home | My Site',
  },
}

// Page (inherits template)
export const metadata: Metadata = {
  title: 'About',  // Renders as "About | My Site"
}

// Override template
export const metadata: Metadata = {
  title: {
    absolute: 'Custom Title',  // Ignores template
  },
}
```

---

## JSON-LD Structured Data

### Available Helpers

| Helper | Schema.org Type | Use Case |
|--------|-----------------|----------|
| `createArticleJsonLd` | Article | Blog posts, news articles |
| `createWebSiteJsonLd` | WebSite | Site-wide search box |
| `createOrganizationJsonLd` | Organization | Company info |
| `createBreadcrumbJsonLd` | BreadcrumbList | Navigation path |
| `createFAQJsonLd` | FAQPage | FAQ sections |
| `createProductJsonLd` | Product | E-commerce products |
| `createLocalBusinessJsonLd` | LocalBusiness | Physical stores |
| `createVideoJsonLd` | VideoObject | Video content |
| `createReviewJsonLd` | Review | User reviews |
| `createCourseJsonLd` | Course | Educational content |
| `createEventJsonLd` | Event | Events (physical/virtual) |
| `createSoftwareAppJsonLd` | SoftwareApplication | Apps |

### Example

```typescript
import { createArticleJsonLd, createBreadcrumbJsonLd } from '@mandujs/core'

export const metadata: Metadata = {
  jsonLd: [
    createArticleJsonLd({
      headline: 'How to Use Mandu',
      author: 'John Doe',
      datePublished: new Date('2024-01-15'),
      publisher: { name: 'Mandu Blog', logo: '/logo.png' },
    }),
    createBreadcrumbJsonLd([
      { name: 'Home', url: 'https://example.com' },
      { name: 'Blog', url: 'https://example.com/blog' },
      { name: 'Article', url: 'https://example.com/blog/article' },
    ]),
  ],
}
```

---

## Sitemap & Robots

### Sitemap Generation

```typescript
// app/sitemap.ts
import type { Sitemap } from '@mandujs/core'

export default function sitemap(): Sitemap {
  return [
    {
      url: 'https://example.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: 'https://example.com/about',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: 'https://example.com/blog',
      images: ['https://example.com/blog-cover.jpg'],
      alternates: {
        languages: {
          en: 'https://example.com/en/blog',
          ko: 'https://example.com/ko/blog',
        },
      },
    },
  ]
}
```

### Robots.txt

```typescript
// app/robots.ts
import type { RobotsFile } from '@mandujs/core'

export default function robots(): RobotsFile {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/private'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        crawlDelay: 2,
      },
    ],
    sitemap: 'https://example.com/sitemap.xml',
  }
}
```

---

## Google SEO Optimization

### Viewport

```typescript
export const metadata: Metadata = {
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    viewportFit: 'cover',
  },
}
```

### Theme Color

```typescript
export const metadata: Metadata = {
  themeColor: [
    { color: '#ffffff', media: '(prefers-color-scheme: light)' },
    { color: '#000000', media: '(prefers-color-scheme: dark)' },
  ],
}
```

### Resource Hints

```typescript
export const metadata: Metadata = {
  resourceHints: {
    preconnect: ['https://fonts.googleapis.com'],
    dnsPrefetch: ['https://cdn.example.com'],
    preload: [
      { href: '/fonts/main.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { href: '/critical.css', as: 'style' },
    ],
    prefetch: ['/next-page.js'],
  },
}
```

### Format Detection (iOS Safari)

```typescript
export const metadata: Metadata = {
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
}
```

### App Links

```typescript
export const metadata: Metadata = {
  appLinks: {
    iosAppStoreId: '123456789',
    iosAppName: 'My App',
    iosUrl: 'myapp://open',
    androidPackage: 'com.example.app',
    androidAppName: 'My App',
    androidUrl: 'https://example.com/android',
  },
}
```

### Google-specific Meta

```typescript
export const metadata: Metadata = {
  google: {
    nositelinkssearchbox: true,  // Disable sitelinks search box
    notranslate: true,           // Disable auto-translate
  },
}
```

---

## SSR Integration

### Basic Usage

```typescript
import { resolveSEO } from '@mandujs/core'

const seoResult = await resolveSEO({
  metadata: [layoutMetadata, pageMetadata],
  routeParams: { slug: 'hello-world' },
})

// seoResult.title - Resolved title string
// seoResult.html - Full HTML meta tags
// seoResult.resolved - ResolvedMetadata object
```

### Streaming SSR Integration

```typescript
import { renderWithSEO } from '@mandujs/core'

const response = await renderWithSEO(<App />, {
  routeId: 'blog-post',
  seo: {
    metadata: [layoutMetadata, pageMetadata],
    routeParams: params,
  },
})
```

---

## Metadata Resolution Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    Layout Chain                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   app/layout.tsx         (root metadata)                    │
│        ↓                                                     │
│   app/blog/layout.tsx    (nested metadata)                  │
│        ↓                                                     │
│   app/blog/[slug]/page   (page metadata)                    │
│        ↓                                                     │
│   ┌──────────────────────────────────────────────┐          │
│   │  resolveMetadata()                           │          │
│   │  - Merge each level                          │          │
│   │  - Apply title templates                     │          │
│   │  - Resolve URLs with metadataBase            │          │
│   │  - Normalize arrays/objects                  │          │
│   └──────────────────────────────────────────────┘          │
│        ↓                                                     │
│   ResolvedMetadata                                          │
│        ↓                                                     │
│   renderMetadata() → HTML string                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Type Definitions

### Core Types

```typescript
interface Metadata {
  metadataBase?: URL | string | null
  title?: string | Title | null
  description?: string | null
  keywords?: string | string[] | null
  authors?: Author | Author[] | null
  openGraph?: OpenGraph | null
  twitter?: Twitter | null
  jsonLd?: JsonLd | JsonLd[] | null
  robots?: Robots | null
  icons?: Icons | null
  manifest?: string | URL | null
  alternates?: AlternateURLs | null
  verification?: Verification | null
  // Google SEO
  viewport?: string | Viewport | null
  themeColor?: string | ThemeColor | ThemeColor[] | null
  google?: GoogleMeta | null
  formatDetection?: FormatDetection | null
  resourceHints?: ResourceHint | null
  appLinks?: AppLinks | null
  other?: Record<string, string | string[]> | null
}

interface Title {
  template?: string
  default?: string
  absolute?: string
}

interface OpenGraph {
  type?: OpenGraphType
  url?: string | URL
  title?: string
  description?: string
  siteName?: string
  locale?: string
  images?: OpenGraphImage | OpenGraphImage[]
  // ... more fields
}
```

---

## Testing

The SEO module includes comprehensive tests covering all features:

```bash
bun test packages/core/tests/seo/seo.test.ts
```

**Test Coverage:** 67 tests across:
- Title resolution & templates
- Metadata merging
- HTML rendering & escaping
- Open Graph & Twitter Cards
- JSON-LD helpers (12 types)
- Sitemap generation
- Robots.txt generation
- Route handlers
- SSR integration
- Google SEO features

---

## References

- [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Open Graph Protocol](https://ogp.me/)
- [Twitter Cards](https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/abouts-cards)
- [Schema.org](https://schema.org/)
- [Google Search Central](https://developers.google.com/search/docs)
