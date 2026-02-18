/**
 * Mandu SEO - Type Definitions
 *
 * Next.js Metadata API 패턴 기반
 * @see https://nextjs.org/docs/app/api-reference/functions/generate-metadata
 */

// ============================================================================
// Basic Types
// ============================================================================

export type ReferrerEnum =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url'

export type ColorSchemeEnum = 'normal' | 'light' | 'dark' | 'light dark' | 'dark light' | 'only light'

// ============================================================================
// Title Types
// ============================================================================

export interface TemplateString {
  default: string
  template?: string  // "%s | My Site" - %s is replaced with page title
  absolute?: string  // Ignores parent template
}

/**
 * 단축형 absolute 타이틀 (템플릿 무시)
 */
export interface AbsoluteString {
  absolute: string
  template?: string
}

export type Title = string | TemplateString | AbsoluteString

export interface AbsoluteTemplateString {
  absolute: string
  template: string | null
}

// ============================================================================
// Author & Creator
// ============================================================================

export interface Author {
  name?: string
  url?: string | URL
}

// ============================================================================
// Robots
// ============================================================================

export interface Robots {
  index?: boolean
  follow?: boolean
  noarchive?: boolean
  nosnippet?: boolean
  noimageindex?: boolean
  nocache?: boolean
  notranslate?: boolean
  'max-snippet'?: number
  'max-image-preview'?: 'none' | 'standard' | 'large'
  'max-video-preview'?: number
  /** Google 전용 설정 (다르게 적용할 경우) */
  googleBot?: Omit<Robots, 'googleBot'>
}

export interface ResolvedRobots {
  basic: string | null
  googleBot: string | null
}

// ============================================================================
// Google SEO Specific
// ============================================================================

/**
 * Google 전용 메타 설정
 */
export interface GoogleMeta {
  /** Google 사이트링크 검색창 비활성화 */
  nositelinkssearchbox?: boolean
  /** Google 번역 제안 비활성화 */
  notranslate?: boolean
}

/**
 * 전화번호/이메일 자동 감지 설정
 */
export interface FormatDetection {
  telephone?: boolean
  date?: boolean
  address?: boolean
  email?: boolean
  url?: boolean
}

/**
 * 리소스 힌트 (성능 최적화)
 */
export interface ResourceHint {
  /** preconnect URLs (외부 도메인 미리 연결) */
  preconnect?: string[]
  /** dns-prefetch URLs (DNS 미리 조회) */
  dnsPrefetch?: string[]
  /** preload resources */
  preload?: Array<{
    href: string
    as: 'script' | 'style' | 'font' | 'image' | 'fetch'
    type?: string
    crossOrigin?: 'anonymous' | 'use-credentials'
  }>
  /** prefetch resources (다음 페이지용) */
  prefetch?: string[]
}

/**
 * App 관련 메타 (PWA, iOS)
 */
export interface AppLinks {
  /** iOS App Store ID */
  iosAppStoreId?: string
  /** iOS App 이름 */
  iosAppName?: string
  /** iOS App URL Scheme */
  iosUrl?: string
  /** Android Package */
  androidPackage?: string
  /** Android App 이름 */
  androidAppName?: string
  /** Android URL */
  androidUrl?: string
}

/**
 * Theme Color 설정
 */
export interface ThemeColor {
  color: string
  media?: string  // e.g., '(prefers-color-scheme: dark)'
}

// ============================================================================
// Icons
// ============================================================================

export type IconURL = string | URL

export interface IconDescriptor {
  url: string | URL
  type?: string
  sizes?: string
  color?: string
  rel?: string
  media?: string
  fetchPriority?: 'auto' | 'high' | 'low'
}

export type Icon = IconURL | IconDescriptor

export interface Icons {
  icon?: Icon | Icon[]
  shortcut?: Icon | Icon[]
  apple?: Icon | Icon[]
  other?: IconDescriptor | IconDescriptor[]
}

export interface ResolvedIcons {
  icon: IconDescriptor[]
  apple: IconDescriptor[]
  shortcut: IconDescriptor[]
  other: IconDescriptor[]
}

// ============================================================================
// Alternate URLs
// ============================================================================

export interface Languages<T> {
  [locale: string]: T
}

export interface AlternateURLs {
  canonical?: string | URL | null
  languages?: Languages<string | URL | null>
  media?: Record<string, string | URL>
  types?: Record<string, string | URL>
}

export interface ResolvedAlternateURLs {
  canonical: URL | null
  languages: Record<string, URL> | null
  media: Record<string, URL> | null
  types: Record<string, URL> | null
}

// ============================================================================
// Verification
// ============================================================================

export interface Verification {
  google?: string | string[]
  yahoo?: string | string[]
  yandex?: string | string[]
  me?: string | string[]
  other?: Record<string, string | string[]>
}

export interface ResolvedVerification {
  google: string[] | null
  yahoo: string[] | null
  yandex: string[] | null
  me: string[] | null
  other: Record<string, string[]> | null
}

// ============================================================================
// Template Literal Types for Meta Properties
// ============================================================================

/** OpenGraph meta property name (og:title, og:description, etc.) */
export type OGProperty = `og:${string}`;

/** Twitter meta property name (twitter:card, twitter:site, etc.) */
export type TwitterProperty = `twitter:${string}`;

/** Union of well-known meta property prefixes plus arbitrary strings */
export type MetaProperty = OGProperty | TwitterProperty | string;

// ============================================================================
// Open Graph Types
// ============================================================================

export interface OpenGraphImage {
  url: string | URL
  secureUrl?: string | URL
  alt?: string
  type?: string
  width?: string | number
  height?: string | number
}

export interface OpenGraphVideo {
  url: string | URL
  secureUrl?: string | URL
  type?: string
  width?: string | number
  height?: string | number
}

export interface OpenGraphAudio {
  url: string | URL
  secureUrl?: string | URL
  type?: string
}

export interface OpenGraphArticle {
  publishedTime?: string
  modifiedTime?: string
  expirationTime?: string
  authors?: string | string[]
  section?: string
  tags?: string[]
}

export interface OpenGraphProfile {
  firstName?: string
  lastName?: string
  username?: string
  gender?: string
}

export interface OpenGraphBook {
  isbn?: string
  releaseDate?: string
  authors?: string | string[]
  tags?: string[]
}

export type OpenGraphType =
  | 'article'
  | 'book'
  | 'music.song'
  | 'music.album'
  | 'music.playlist'
  | 'music.radio_station'
  | 'profile'
  | 'video.movie'
  | 'video.episode'
  | 'video.tv_show'
  | 'video.other'
  | 'website'

export interface OpenGraph {
  type?: OpenGraphType
  url?: string | URL
  title?: string
  description?: string
  siteName?: string
  locale?: string
  images?: string | URL | OpenGraphImage | (string | URL | OpenGraphImage)[]
  videos?: string | URL | OpenGraphVideo | (string | URL | OpenGraphVideo)[]
  audio?: string | URL | OpenGraphAudio | (string | URL | OpenGraphAudio)[]
  determiner?: 'a' | 'an' | 'the' | 'auto' | ''
  // Type-specific
  article?: OpenGraphArticle
  profile?: OpenGraphProfile
  book?: OpenGraphBook
}

export interface ResolvedOpenGraph {
  type: OpenGraphType
  url: URL | null
  title: string | null
  description: string | null
  siteName: string | null
  locale: string | null
  images: OpenGraphImage[] | null
  videos: OpenGraphVideo[] | null
  audio: OpenGraphAudio[] | null
  determiner: string | null
  article: OpenGraphArticle | null
  profile: OpenGraphProfile | null
  book: OpenGraphBook | null
}

// ============================================================================
// Twitter Types
// ============================================================================

export type TwitterCardType = 'summary' | 'summary_large_image' | 'app' | 'player'

export interface TwitterImage {
  url: string | URL
  alt?: string
}

export interface TwitterPlayer {
  playerUrl: string | URL
  streamUrl?: string | URL
  width: number
  height: number
}

export interface TwitterApp {
  id: {
    iphone?: string | number
    ipad?: string | number
    googleplay?: string
  }
  url?: {
    iphone?: string | URL
    ipad?: string | URL
    googleplay?: string | URL
  }
  name?: string
}

export interface Twitter {
  card?: TwitterCardType
  site?: string
  siteId?: string
  creator?: string
  creatorId?: string
  title?: string
  description?: string
  images?: string | URL | TwitterImage | (string | URL | TwitterImage)[]
  // Player card
  players?: TwitterPlayer | TwitterPlayer[]
  // App card
  app?: TwitterApp
}

export interface ResolvedTwitter {
  card: TwitterCardType
  site: string | null
  siteId: string | null
  creator: string | null
  creatorId: string | null
  title: string | null
  description: string | null
  images: TwitterImage[] | null
  players: TwitterPlayer[] | null
  app: TwitterApp | null
}

// ============================================================================
// JSON-LD Types
// ============================================================================

export type JsonLdType =
  | 'Article'
  | 'BlogPosting'
  | 'NewsArticle'
  | 'WebSite'
  | 'WebPage'
  | 'Organization'
  | 'Person'
  | 'Product'
  | 'BreadcrumbList'
  | 'FAQPage'
  | 'HowTo'
  | 'Recipe'
  | 'Event'
  | 'LocalBusiness'
  | 'SoftwareApplication'

export interface JsonLd {
  '@context'?: string
  '@type': JsonLdType | string
  [key: string]: unknown
}

// ============================================================================
// Main Metadata Interface
// ============================================================================

export interface Metadata {
  // Base URL for resolving relative URLs
  metadataBase?: string | URL | null

  // Basic
  title?: Title | null
  description?: string | null
  applicationName?: string | null
  authors?: Author | Author[] | null
  generator?: string | null
  keywords?: string | string[] | null
  referrer?: ReferrerEnum | null
  creator?: string | null
  publisher?: string | null
  robots?: string | Robots | null

  // Alternate URLs
  alternates?: AlternateURLs | null

  // Icons
  icons?: IconURL | Icon[] | Icons | null

  // Manifest
  manifest?: string | URL | null

  // Open Graph
  openGraph?: OpenGraph | null

  // Twitter
  twitter?: Twitter | null

  // Verification
  verification?: Verification | null

  // Category
  category?: string | null
  classification?: string | null

  // JSON-LD
  jsonLd?: JsonLd | JsonLd[] | null

  // === Google SEO 최적화 ===

  /** Google 전용 메타 설정 */
  google?: GoogleMeta | null

  /** 전화번호/이메일 자동 감지 설정 */
  formatDetection?: FormatDetection | null

  /** 리소스 힌트 (성능 최적화) */
  resourceHints?: ResourceHint | null

  /** Theme Color (브라우저 UI, PWA) */
  themeColor?: string | ThemeColor | ThemeColor[] | null

  /** Viewport 설정 (기본값: width=device-width, initial-scale=1) */
  viewport?: string | {
    width?: string | number
    height?: string | number
    initialScale?: number
    minimumScale?: number
    maximumScale?: number
    userScalable?: boolean
    viewportFit?: 'auto' | 'cover' | 'contain'
  } | null

  /** App Links (iOS/Android 앱 연동) */
  appLinks?: AppLinks | null

  // Other custom meta tags
  other?: Record<string, string | number | (string | number)[]> | null
}

// ============================================================================
// Resolved Metadata (after processing)
// ============================================================================

export interface ResolvedMetadata {
  metadataBase: URL | null
  title: AbsoluteTemplateString | null
  description: string | null
  applicationName: string | null
  authors: Author[] | null
  generator: string | null
  keywords: string[] | null
  referrer: ReferrerEnum | null
  creator: string | null
  publisher: string | null
  robots: ResolvedRobots | null
  alternates: ResolvedAlternateURLs | null
  icons: ResolvedIcons | null
  manifest: URL | null
  openGraph: ResolvedOpenGraph | null
  twitter: ResolvedTwitter | null
  verification: ResolvedVerification | null
  category: string | null
  classification: string | null
  jsonLd: JsonLd[] | null
  // Google SEO 최적화
  google: GoogleMeta | null
  formatDetection: FormatDetection | null
  resourceHints: ResourceHint | null
  themeColor: ThemeColor[] | null
  viewport: string | null
  appLinks: AppLinks | null
  other: Record<string, string | number | (string | number)[]> | null
}

// ============================================================================
// Metadata Route Types (sitemap.ts, robots.ts)
// ============================================================================

export interface SitemapEntry {
  url: string
  lastModified?: string | Date
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority?: number
  alternates?: {
    languages?: Languages<string>
  }
  images?: string[]
}

export type Sitemap = SitemapEntry[]

export interface RobotsRule {
  userAgent?: string | string[]
  allow?: string | string[]
  disallow?: string | string[]
  crawlDelay?: number
}

export interface RobotsFile {
  rules: RobotsRule | RobotsRule[]
  sitemap?: string | string[]
  host?: string
}

// ============================================================================
// Metadata Route Namespace
// ============================================================================

export namespace MetadataRoute {
  export type Sitemap = SitemapEntry[]
  export type Robots = RobotsFile
}

// ============================================================================
// Generator Function Types
// ============================================================================

export interface MetadataParams {
  params: Record<string, string>
  searchParams: Record<string, string>
}

export type GenerateMetadata = (
  props: MetadataParams,
  parent: Promise<ResolvedMetadata>
) => Metadata | Promise<Metadata>

export type MetadataItem = Metadata | GenerateMetadata | null
