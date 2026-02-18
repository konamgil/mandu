/**
 * SEO Module Tests
 */
import { describe, it, expect } from 'bun:test'
import {
  resolveMetadata,
  renderMetadata,
  createDefaultMetadata,
  resolveTitle,
  createArticleJsonLd,
  createBreadcrumbJsonLd,
  createLocalBusinessJsonLd,
  createVideoJsonLd,
  createReviewJsonLd,
  createCourseJsonLd,
  createEventJsonLd,
  createSoftwareAppJsonLd,
  createFAQJsonLd,
  createProductJsonLd,
  createWebSiteJsonLd,
  createOrganizationJsonLd,
  renderSitemap,
  renderSitemapIndex,
  renderRobots,
  createDefaultRobots,
  createSitemapHandler,
  createRobotsHandler,
  buildMetadataRoutes,
  resolveSEO,
  resolveSEOSync,
  injectSEOIntoOptions,
  layoutEntriesToMetadataItems,
  renderGoogle,
  renderFormatDetection,
  renderThemeColor,
  renderViewport,
  renderResourceHints,
  renderAppLinks,
} from '../../src/seo'
import type { Metadata, MetadataItem, Sitemap, RobotsFile, LayoutMetadataEntry } from '../../src/seo'

describe('SEO Module', () => {
  describe('resolveTitle', () => {
    it('should resolve string title', () => {
      const result = resolveTitle('Hello World', null)
      expect(result?.absolute).toBe('Hello World')
    })

    it('should apply title template', () => {
      const result = resolveTitle('Page Title', '%s | My Site')
      expect(result?.absolute).toBe('Page Title | My Site')
    })

    it('should handle title with template override', () => {
      const result = resolveTitle({ default: 'Default', template: '%s - Site' }, null)
      expect(result?.absolute).toBe('Default')
      expect(result?.template).toBe('%s - Site')
    })

    it('should handle absolute title (ignores template)', () => {
      const result = resolveTitle({ absolute: 'Absolute Title' }, '%s | Site')
      expect(result?.absolute).toBe('Absolute Title')
    })
  })

  describe('resolveMetadata', () => {
    it('should resolve basic metadata', async () => {
      const items: MetadataItem[] = [
        {
          title: 'Home Page',
          description: 'Welcome to our site',
        },
      ]

      const resolved = await resolveMetadata(items)
      expect(resolved.title?.absolute).toBe('Home Page')
      expect(resolved.description).toBe('Welcome to our site')
    })

    it('should merge metadata from multiple sources', async () => {
      const items: MetadataItem[] = [
        {
          title: { template: '%s | My Site', default: 'My Site' },
          description: 'Site description',
        },
        {
          title: 'Blog Post',
        },
      ]

      const resolved = await resolveMetadata(items)
      expect(resolved.title?.absolute).toBe('Blog Post | My Site')
    })

    it('should handle dynamic metadata', async () => {
      const items: MetadataItem[] = [
        async ({ params }) => ({
          title: `Article: ${params.slug}`,
          openGraph: {
            title: `Article: ${params.slug}`,
            type: 'article',
          },
        }),
      ]

      const resolved = await resolveMetadata(items, { slug: 'hello-world' })
      expect(resolved.title?.absolute).toBe('Article: hello-world')
      expect(resolved.openGraph?.type).toBe('article')
    })
  })

  describe('renderMetadata', () => {
    it('should render title tag', () => {
      const resolved = createDefaultMetadata()
      resolved.title = { absolute: 'Test Title', template: null }

      const html = renderMetadata(resolved)
      expect(html).toContain('<title>Test Title</title>')
    })

    it('should render description meta tag', () => {
      const resolved = createDefaultMetadata()
      resolved.description = 'Test description'

      const html = renderMetadata(resolved)
      expect(html).toContain('<meta name="description" content="Test description" />')
    })

    it('should escape HTML in meta content', () => {
      const resolved = createDefaultMetadata()
      resolved.title = { absolute: 'Test <script>alert(1)</script>', template: null }
      resolved.description = 'Description with "quotes" and <tags>'

      const html = renderMetadata(resolved)
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('&quot;quotes&quot;')
    })

    it('should render Open Graph tags', () => {
      const resolved = createDefaultMetadata()
      resolved.title = { absolute: 'OG Test', template: null }
      resolved.openGraph = {
        type: 'website',
        url: new URL('https://example.com'),
        title: 'OG Title',
        description: 'OG Description',
        siteName: 'Example Site',
        locale: 'en_US',
        images: [{ url: 'https://example.com/image.jpg', alt: 'Image' }],
        videos: null,
        audio: null,
        determiner: null,
        article: null,
        profile: null,
        book: null,
      }

      const html = renderMetadata(resolved)
      expect(html).toContain('<meta property="og:type" content="website" />')
      expect(html).toContain('<meta property="og:title" content="OG Title" />')
      expect(html).toContain('<meta property="og:url" content="https://example.com/" />')
      expect(html).toContain('<meta property="og:image" content="https://example.com/image.jpg" />')
    })

    it('should render Twitter Card tags', () => {
      const resolved = createDefaultMetadata()
      resolved.twitter = {
        card: 'summary_large_image',
        site: '@example',
        creator: '@author',
        title: 'Twitter Title',
        description: 'Twitter Description',
        images: [{ url: 'https://example.com/twitter.jpg', alt: 'Twitter Image' }],
        players: null,
        app: null,
        siteId: null,
        creatorId: null,
      }

      const html = renderMetadata(resolved)
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
      expect(html).toContain('<meta name="twitter:site" content="@example" />')
      expect(html).toContain('<meta name="twitter:title" content="Twitter Title" />')
    })
  })

  describe('JSON-LD Helpers', () => {
    it('should create Article JSON-LD', () => {
      const jsonLd = createArticleJsonLd({
        headline: 'Test Article',
        description: 'Article description',
        author: 'John Doe',
        datePublished: '2024-01-15',
      })

      expect(jsonLd['@context']).toBe('https://schema.org')
      expect(jsonLd['@type']).toBe('Article')
      expect(jsonLd.headline).toBe('Test Article')
      expect((jsonLd.author as { name: string }).name).toBe('John Doe')
    })

    it('should create Breadcrumb JSON-LD', () => {
      const jsonLd = createBreadcrumbJsonLd([
        { name: 'Home', url: 'https://example.com' },
        { name: 'Blog', url: 'https://example.com/blog' },
        { name: 'Post', url: 'https://example.com/blog/post' },
      ])

      expect(jsonLd['@type']).toBe('BreadcrumbList')
      expect((jsonLd.itemListElement as unknown[]).length).toBe(3)
    })

    it('should create LocalBusiness JSON-LD', () => {
      const jsonLd = createLocalBusinessJsonLd({
        name: 'Coffee Shop',
        description: 'Best coffee in town',
        telephone: '+1-555-123-4567',
        address: {
          streetAddress: '123 Main St',
          addressLocality: 'Seoul',
          postalCode: '12345',
          addressCountry: 'KR',
        },
        geo: {
          latitude: 37.5665,
          longitude: 126.978,
        },
        priceRange: '$$',
      })

      expect(jsonLd['@context']).toBe('https://schema.org')
      expect(jsonLd['@type']).toBe('LocalBusiness')
      expect(jsonLd.name).toBe('Coffee Shop')
      expect((jsonLd.address as { '@type': string })['@type']).toBe('PostalAddress')
      expect((jsonLd.geo as { latitude: number }).latitude).toBe(37.5665)
    })

    it('should create Video JSON-LD', () => {
      const jsonLd = createVideoJsonLd({
        name: 'Introduction Video',
        description: 'Welcome to our channel',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        uploadDate: new Date('2024-01-15'),
        duration: 'PT5M30S',
        contentUrl: 'https://example.com/video.mp4',
        interactionCount: 1000,
      })

      expect(jsonLd['@type']).toBe('VideoObject')
      expect(jsonLd.name).toBe('Introduction Video')
      expect(jsonLd.duration).toBe('PT5M30S')
      expect((jsonLd.interactionStatistic as { userInteractionCount: number }).userInteractionCount).toBe(1000)
    })

    it('should create Review JSON-LD', () => {
      const jsonLd = createReviewJsonLd({
        itemReviewed: { type: 'Product', name: 'Amazing Product' },
        author: { name: 'John Doe', url: 'https://example.com/john' },
        reviewRating: { ratingValue: 4.5, bestRating: 5 },
        reviewBody: 'Great product!',
        datePublished: '2024-01-15',
      })

      expect(jsonLd['@type']).toBe('Review')
      expect((jsonLd.itemReviewed as { name: string }).name).toBe('Amazing Product')
      expect((jsonLd.reviewRating as { ratingValue: number }).ratingValue).toBe(4.5)
    })

    it('should create Course JSON-LD', () => {
      const jsonLd = createCourseJsonLd({
        name: 'Web Development 101',
        description: 'Learn web development from scratch',
        provider: { name: 'Tech Academy', url: 'https://techacademy.com' },
        offers: { price: 99.99, priceCurrency: 'USD' },
      })

      expect(jsonLd['@type']).toBe('Course')
      expect(jsonLd.name).toBe('Web Development 101')
      expect((jsonLd.provider as { name: string }).name).toBe('Tech Academy')
      expect((jsonLd.offers as { price: number }).price).toBe(99.99)
    })

    it('should create Event JSON-LD', () => {
      const jsonLd = createEventJsonLd({
        name: 'Tech Conference 2024',
        description: 'Annual technology conference',
        startDate: new Date('2024-06-15T09:00:00Z'),
        endDate: new Date('2024-06-17T18:00:00Z'),
        location: { name: 'Convention Center', address: '456 Event Blvd' },
        eventStatus: 'EventScheduled',
        eventAttendanceMode: 'OfflineEventAttendanceMode',
      })

      expect(jsonLd['@type']).toBe('Event')
      expect(jsonLd.name).toBe('Tech Conference 2024')
      expect(jsonLd.eventStatus).toBe('https://schema.org/EventScheduled')
      expect((jsonLd.location as { '@type': string })['@type']).toBe('Place')
    })

    it('should create Event JSON-LD with virtual location', () => {
      const jsonLd = createEventJsonLd({
        name: 'Online Webinar',
        startDate: '2024-06-15T09:00:00Z',
        location: { type: 'VirtualLocation', url: 'https://zoom.us/meeting/123' },
        eventAttendanceMode: 'OnlineEventAttendanceMode',
      })

      expect((jsonLd.location as { '@type': string })['@type']).toBe('VirtualLocation')
      expect((jsonLd.location as { url: string }).url).toBe('https://zoom.us/meeting/123')
    })

    it('should create SoftwareApp JSON-LD', () => {
      const jsonLd = createSoftwareAppJsonLd({
        name: 'My Awesome App',
        description: 'The best app ever',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'iOS, Android',
        offers: { price: 0, priceCurrency: 'USD' },
        aggregateRating: { ratingValue: 4.8, ratingCount: 1500 },
        downloadUrl: 'https://example.com/download',
      })

      expect(jsonLd['@type']).toBe('SoftwareApplication')
      expect(jsonLd.applicationCategory).toBe('BusinessApplication')
      expect((jsonLd.aggregateRating as { ratingValue: number }).ratingValue).toBe(4.8)
    })

    it('should create FAQ JSON-LD', () => {
      const jsonLd = createFAQJsonLd([
        { question: 'What is this?', answer: 'This is a FAQ.' },
        { question: 'How does it work?', answer: 'It works great!' },
      ])

      expect(jsonLd['@type']).toBe('FAQPage')
      expect((jsonLd.mainEntity as unknown[]).length).toBe(2)
    })

    it('should create Product JSON-LD', () => {
      const jsonLd = createProductJsonLd({
        name: 'Premium Widget',
        description: 'High quality widget',
        brand: 'WidgetCo',
        sku: 'WIDGET-001',
        offers: {
          price: 29.99,
          priceCurrency: 'USD',
          availability: 'InStock',
        },
        aggregateRating: { ratingValue: 4.5, reviewCount: 100 },
      })

      expect(jsonLd['@type']).toBe('Product')
      expect((jsonLd.brand as { name: string }).name).toBe('WidgetCo')
      expect((jsonLd.offers as { availability: string }).availability).toBe('https://schema.org/InStock')
    })

    it('should create WebSite JSON-LD with search action', () => {
      const jsonLd = createWebSiteJsonLd({
        name: 'My Website',
        url: 'https://example.com',
        description: 'Welcome to my website',
        potentialAction: {
          searchUrl: 'https://example.com/search?q={search_term_string}',
          queryInput: 'required name=search_term_string',
        },
      })

      expect(jsonLd['@type']).toBe('WebSite')
      expect((jsonLd.potentialAction as { '@type': string })['@type']).toBe('SearchAction')
    })

    it('should create Organization JSON-LD', () => {
      const jsonLd = createOrganizationJsonLd({
        name: 'Acme Corp',
        url: 'https://acme.com',
        logo: 'https://acme.com/logo.png',
        sameAs: ['https://twitter.com/acme', 'https://facebook.com/acme'],
        contactPoint: {
          telephone: '+1-555-123-4567',
          contactType: 'customer service',
        },
      })

      expect(jsonLd['@type']).toBe('Organization')
      expect((jsonLd.sameAs as string[]).length).toBe(2)
      expect((jsonLd.contactPoint as { '@type': string })['@type']).toBe('ContactPoint')
    })
  })

  describe('Google SEO Rendering', () => {
    describe('renderGoogle', () => {
      it('should render nositelinkssearchbox meta tag', () => {
        const resolved = createDefaultMetadata()
        resolved.google = { nositelinkssearchbox: true }

        const html = renderGoogle(resolved)
        expect(html).toContain('<meta name="google" content="nositelinkssearchbox" />')
      })

      it('should render notranslate meta tag', () => {
        const resolved = createDefaultMetadata()
        resolved.google = { notranslate: true }

        const html = renderGoogle(resolved)
        expect(html).toContain('<meta name="google" content="notranslate" />')
      })

      it('should render both google meta tags', () => {
        const resolved = createDefaultMetadata()
        resolved.google = { nositelinkssearchbox: true, notranslate: true }

        const html = renderGoogle(resolved)
        expect(html).toContain('nositelinkssearchbox')
        expect(html).toContain('notranslate')
      })

      it('should return empty string when no google meta', () => {
        const resolved = createDefaultMetadata()
        const html = renderGoogle(resolved)
        expect(html).toBe('')
      })
    })

    describe('renderViewport', () => {
      it('should render viewport string directly', () => {
        const resolved = createDefaultMetadata()
        resolved.viewport = 'width=device-width, initial-scale=1'

        const html = renderViewport(resolved)
        expect(html).toBe('<meta name="viewport" content="width=device-width, initial-scale=1" />')
      })

      it('should return empty string when no viewport', () => {
        const resolved = createDefaultMetadata()
        const html = renderViewport(resolved)
        expect(html).toBe('')
      })
    })

    describe('renderThemeColor', () => {
      it('should render single theme color', () => {
        const resolved = createDefaultMetadata()
        resolved.themeColor = [{ color: '#ff0000' }]

        const html = renderThemeColor(resolved)
        expect(html).toBe('<meta name="theme-color" content="#ff0000" />')
      })

      it('should render theme color with media query', () => {
        const resolved = createDefaultMetadata()
        resolved.themeColor = [
          { color: '#ffffff', media: '(prefers-color-scheme: light)' },
          { color: '#000000', media: '(prefers-color-scheme: dark)' },
        ]

        const html = renderThemeColor(resolved)
        expect(html).toContain('content="#ffffff" media="(prefers-color-scheme: light)"')
        expect(html).toContain('content="#000000" media="(prefers-color-scheme: dark)"')
      })

      it('should return empty string when no theme color', () => {
        const resolved = createDefaultMetadata()
        const html = renderThemeColor(resolved)
        expect(html).toBe('')
      })
    })

    describe('renderFormatDetection', () => {
      it('should render format detection tags', () => {
        const resolved = createDefaultMetadata()
        resolved.formatDetection = {
          telephone: false,
          date: false,
          address: false,
          email: false,
        }

        const html = renderFormatDetection(resolved)
        expect(html).toContain('telephone=no')
        expect(html).toContain('date=no')
        expect(html).toContain('address=no')
        expect(html).toContain('email=no')
      })

      it('should render only disabled detections', () => {
        const resolved = createDefaultMetadata()
        resolved.formatDetection = { telephone: false }

        const html = renderFormatDetection(resolved)
        expect(html).toBe('<meta name="format-detection" content="telephone=no" />')
      })

      it('should return empty string when no format detection', () => {
        const resolved = createDefaultMetadata()
        const html = renderFormatDetection(resolved)
        expect(html).toBe('')
      })
    })

    describe('renderResourceHints', () => {
      it('should render dns-prefetch hints', () => {
        const resolved = createDefaultMetadata()
        resolved.resourceHints = {
          dnsPrefetch: ['https://fonts.googleapis.com', 'https://cdn.example.com'],
        }

        const html = renderResourceHints(resolved)
        expect(html).toContain('<link rel="dns-prefetch" href="https://fonts.googleapis.com" />')
        expect(html).toContain('<link rel="dns-prefetch" href="https://cdn.example.com" />')
      })

      it('should render preconnect hints', () => {
        const resolved = createDefaultMetadata()
        resolved.resourceHints = {
          preconnect: ['https://fonts.gstatic.com'],
        }

        const html = renderResourceHints(resolved)
        expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />')
      })

      it('should render preload hints', () => {
        const resolved = createDefaultMetadata()
        resolved.resourceHints = {
          preload: [
            { href: '/fonts/main.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
            { href: '/critical.css', as: 'style' },
          ],
        }

        const html = renderResourceHints(resolved)
        expect(html).toContain('rel="preload"')
        expect(html).toContain('href="/fonts/main.woff2"')
        expect(html).toContain('as="font"')
        expect(html).toContain('type="font/woff2"')
        expect(html).toContain('crossorigin="anonymous"')
        expect(html).toContain('href="/critical.css"')
        expect(html).toContain('as="style"')
      })

      it('should render prefetch hints', () => {
        const resolved = createDefaultMetadata()
        resolved.resourceHints = {
          prefetch: ['/next-page.js', '/images/hero.jpg'],
        }

        const html = renderResourceHints(resolved)
        expect(html).toContain('<link rel="prefetch" href="/next-page.js" />')
        expect(html).toContain('<link rel="prefetch" href="/images/hero.jpg" />')
      })

      it('should return empty string when no resource hints', () => {
        const resolved = createDefaultMetadata()
        const html = renderResourceHints(resolved)
        expect(html).toBe('')
      })
    })

    describe('renderAppLinks', () => {
      it('should render iOS app store meta tag', () => {
        const resolved = createDefaultMetadata()
        resolved.appLinks = {
          iosAppStoreId: '123456789',
        }

        const html = renderAppLinks(resolved)
        expect(html).toContain('<meta name="apple-itunes-app" content="app-id=123456789" />')
      })

      it('should render Android app links', () => {
        const resolved = createDefaultMetadata()
        resolved.appLinks = {
          androidPackage: 'com.example.app',
          androidAppName: 'My App',
          androidUrl: 'https://example.com/android',
        }

        const html = renderAppLinks(resolved)
        expect(html).toContain('<meta property="al:android:package" content="com.example.app" />')
        expect(html).toContain('<meta property="al:android:app_name" content="My App" />')
        expect(html).toContain('<meta property="al:android:url" content="https://example.com/android" />')
      })

      it('should render iOS app links', () => {
        const resolved = createDefaultMetadata()
        resolved.appLinks = {
          iosAppName: 'My iOS App',
          iosUrl: 'myapp://open',
        }

        const html = renderAppLinks(resolved)
        expect(html).toContain('<meta property="al:ios:app_name" content="My iOS App" />')
        expect(html).toContain('<meta property="al:ios:url" content="myapp://open" />')
      })

      it('should return empty string when no app links', () => {
        const resolved = createDefaultMetadata()
        const html = renderAppLinks(resolved)
        expect(html).toBe('')
      })
    })

    describe('Full metadata rendering with Google SEO', () => {
      it('should render complete metadata with all Google SEO features', () => {
        const resolved = createDefaultMetadata()
        resolved.title = { absolute: 'Test Page', template: null }
        resolved.description = 'Test description'
        resolved.viewport = 'width=device-width, initial-scale=1'
        resolved.themeColor = [{ color: '#4285f4' }]
        resolved.google = { notranslate: true }
        resolved.formatDetection = { telephone: false }
        resolved.resourceHints = {
          preconnect: ['https://fonts.googleapis.com'],
          dnsPrefetch: ['https://cdn.example.com'],
        }
        resolved.appLinks = { iosAppStoreId: '123456' }

        const html = renderMetadata(resolved)

        // Verify order and presence
        expect(html).toContain('<meta name="viewport"')
        expect(html).toContain('<title>Test Page</title>')
        expect(html).toContain('<meta name="description"')
        expect(html).toContain('<meta name="theme-color"')
        expect(html).toContain('<meta name="google" content="notranslate"')
        expect(html).toContain('<meta name="format-detection"')
        expect(html).toContain('<link rel="preconnect"')
        expect(html).toContain('<link rel="dns-prefetch"')
        expect(html).toContain('<meta name="apple-itunes-app"')
      })
    })
  })

  describe('Sitemap Rendering', () => {
    it('should render basic sitemap XML', () => {
      const sitemap: Sitemap = [
        { url: 'https://example.com', priority: 1.0 },
        { url: 'https://example.com/about', changeFrequency: 'monthly' },
      ]

      const xml = renderSitemap(sitemap)

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
      expect(xml).toContain('<loc>https://example.com</loc>')
      expect(xml).toContain('<priority>1.0</priority>')
      expect(xml).toContain('<changefreq>monthly</changefreq>')
      expect(xml).toContain('</urlset>')
    })

    it('should render sitemap with lastModified date', () => {
      const sitemap: Sitemap = [
        { url: 'https://example.com', lastModified: new Date('2024-01-15T00:00:00Z') },
      ]

      const xml = renderSitemap(sitemap)

      expect(xml).toContain('<lastmod>2024-01-15T00:00:00.000Z</lastmod>')
    })

    it('should render sitemap with images', () => {
      const sitemap: Sitemap = [
        {
          url: 'https://example.com/post',
          images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
        },
      ]

      const xml = renderSitemap(sitemap)

      expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')
      expect(xml).toContain('<image:image>')
      expect(xml).toContain('<image:loc>https://example.com/image1.jpg</image:loc>')
    })

    it('should render sitemap with alternate languages', () => {
      const sitemap: Sitemap = [
        {
          url: 'https://example.com',
          alternates: {
            languages: {
              en: 'https://example.com/en',
              ko: 'https://example.com/ko',
            },
          },
        },
      ]

      const xml = renderSitemap(sitemap)

      expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
      expect(xml).toContain('xhtml:link rel="alternate" hreflang="en"')
      expect(xml).toContain('xhtml:link rel="alternate" hreflang="ko"')
    })

    it('should render sitemap index', () => {
      const sitemaps = [
        { url: 'https://example.com/sitemap-0.xml', lastModified: '2024-01-15' },
        { url: 'https://example.com/sitemap-1.xml' },
      ]

      const xml = renderSitemapIndex(sitemaps)

      expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
      expect(xml).toContain('<loc>https://example.com/sitemap-0.xml</loc>')
      expect(xml).toContain('<lastmod>2024-01-15</lastmod>')
      expect(xml).toContain('</sitemapindex>')
    })
  })

  describe('Robots.txt Rendering', () => {
    it('should render basic robots.txt', () => {
      const robots: RobotsFile = {
        rules: {
          userAgent: '*',
          allow: '/',
          disallow: '/admin',
        },
      }

      const txt = renderRobots(robots)

      expect(txt).toContain('User-agent: *')
      expect(txt).toContain('Allow: /')
      expect(txt).toContain('Disallow: /admin')
    })

    it('should render robots with multiple rules', () => {
      const robots: RobotsFile = {
        rules: [
          { userAgent: '*', disallow: '/private' },
          { userAgent: 'Googlebot', allow: '/' },
        ],
      }

      const txt = renderRobots(robots)

      expect(txt).toContain('User-agent: *')
      expect(txt).toContain('Disallow: /private')
      expect(txt).toContain('User-agent: Googlebot')
      expect(txt).toContain('Allow: /')
    })

    it('should render robots with sitemap', () => {
      const robots: RobotsFile = {
        rules: { userAgent: '*', allow: '/' },
        sitemap: 'https://example.com/sitemap.xml',
      }

      const txt = renderRobots(robots)

      expect(txt).toContain('Sitemap: https://example.com/sitemap.xml')
    })

    it('should render robots with multiple sitemaps', () => {
      const robots: RobotsFile = {
        rules: { userAgent: '*', allow: '/' },
        sitemap: [
          'https://example.com/sitemap-0.xml',
          'https://example.com/sitemap-1.xml',
        ],
      }

      const txt = renderRobots(robots)

      expect(txt).toContain('Sitemap: https://example.com/sitemap-0.xml')
      expect(txt).toContain('Sitemap: https://example.com/sitemap-1.xml')
    })

    it('should render robots with crawl-delay', () => {
      const robots: RobotsFile = {
        rules: {
          userAgent: '*',
          allow: '/',
          crawlDelay: 10,
        },
      }

      const txt = renderRobots(robots)

      expect(txt).toContain('Crawl-delay: 10')
    })

    it('should create default robots', () => {
      const robots = createDefaultRobots('https://example.com/sitemap.xml')

      expect(robots.rules).toEqual({ userAgent: '*', allow: '/' })
      expect(robots.sitemap).toBe('https://example.com/sitemap.xml')
    })
  })

  describe('Route Handlers', () => {
    it('should create sitemap handler', async () => {
      const sitemapFn = () => [
        { url: 'https://example.com', priority: 1.0 },
      ]

      const handler = createSitemapHandler(sitemapFn)
      const response = await handler()

      expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
      const xml = await response.text()
      expect(xml).toContain('<loc>https://example.com</loc>')
    })

    it('should create robots handler', async () => {
      const robotsFn = () => ({
        rules: { userAgent: '*', allow: '/' },
        sitemap: 'https://example.com/sitemap.xml',
      })

      const handler = createRobotsHandler(robotsFn)
      const response = await handler()

      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
      const txt = await response.text()
      expect(txt).toContain('User-agent: *')
      expect(txt).toContain('Sitemap: https://example.com/sitemap.xml')
    })

    it('should build metadata routes', () => {
      const routes = buildMetadataRoutes({
        sitemap: () => [{ url: 'https://example.com' }],
        robots: () => ({ rules: { userAgent: '*', allow: '/' } }),
      })

      expect(routes.length).toBe(2)
      expect(routes[0].path).toBe('/sitemap.xml')
      expect(routes[0].method).toBe('GET')
      expect(routes[1].path).toBe('/robots.txt')
      expect(routes[1].method).toBe('GET')
    })
  })

  describe('SSR Integration', () => {
    it('should resolve SEO with static metadata', async () => {
      const result = await resolveSEO({
        staticMetadata: {
          title: 'Test Page',
          description: 'Test description',
        },
      })

      expect(result.title).toBe('Test Page')
      expect(result.html).toContain('<title>Test Page</title>')
      expect(result.html).toContain('content="Test description"')
    })

    it('should resolve SEO with metadata chain', async () => {
      const result = await resolveSEO({
        metadata: [
          { title: { template: '%s | My Site', default: 'My Site' } },
          { title: 'Blog Post' },
        ],
      })

      expect(result.title).toBe('Blog Post | My Site')
      expect(result.html).toContain('<title>Blog Post | My Site</title>')
    })

    it('should resolve SEO sync for static metadata', () => {
      const result = resolveSEOSync({
        title: 'Static Page',
        description: 'Static description',
      })

      expect(result.title).toBe('Static Page')
      expect(result.html).toContain('<title>Static Page</title>')
    })

    it('should inject SEO into streaming options', async () => {
      const baseOptions = {
        routeId: 'test-route',
        headTags: '<link rel="stylesheet" href="/style.css">',
      }

      const result = await injectSEOIntoOptions(baseOptions, {
        staticMetadata: {
          title: 'Injected Title',
          description: 'Injected description',
        },
      })

      expect(result.title).toBe('Injected Title')
      expect(result.headTags).toContain('content="Injected description"')
      expect(result.headTags).toContain('<link rel="stylesheet"')
    })

    it('should convert layout entries to metadata items', () => {
      const entries: LayoutMetadataEntry[] = [
        { path: 'app/layout.tsx', metadata: { title: { default: '', template: '%s | Site' } } },
        { path: 'app/blog/page.tsx', generateMetadata: async ({ params }) => ({ title: params.slug }) },
      ]

      const items = layoutEntriesToMetadataItems(entries)

      expect(items.length).toBe(2)
      expect(items[0]).toEqual({ title: { default: '', template: '%s | Site' } })
      expect(typeof items[1]).toBe('function')
    })

    it('should resolve dynamic metadata with params', async () => {
      const result = await resolveSEO({
        metadata: [
          async ({ params }) => ({
            title: `Article: ${params.id}`,
            openGraph: { title: `Article: ${params.id}` },
          }),
        ],
        routeParams: { id: '123' },
      })

      expect(result.title).toBe('Article: 123')
      expect(result.html).toContain('og:title')
    })
  })
})
