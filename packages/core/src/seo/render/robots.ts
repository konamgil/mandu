/**
 * Mandu SEO - Robots.txt Rendering
 *
 * RobotsFile 객체를 텍스트 문자열로 변환
 */

import type { RobotsFile, RobotsRule } from '../types'

/**
 * 값을 배열로 정규화
 */
function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * 단일 규칙을 텍스트로 변환
 */
function renderRule(rule: RobotsRule): string {
  const lines: string[] = []

  // User-agent
  const userAgents = toArray(rule.userAgent)
  if (userAgents.length === 0) {
    userAgents.push('*')
  }

  for (const ua of userAgents) {
    lines.push(`User-agent: ${ua}`)
  }

  // Allow
  const allows = toArray(rule.allow)
  for (const allow of allows) {
    lines.push(`Allow: ${allow}`)
  }

  // Disallow
  const disallows = toArray(rule.disallow)
  for (const disallow of disallows) {
    lines.push(`Disallow: ${disallow}`)
  }

  // Crawl-delay
  if (rule.crawlDelay !== undefined) {
    lines.push(`Crawl-delay: ${rule.crawlDelay}`)
  }

  return lines.join('\n')
}

/**
 * RobotsFile 객체를 robots.txt 문자열로 렌더링
 *
 * @param robots - Robots 설정 객체
 * @returns robots.txt 문자열
 *
 * @example
 * ```typescript
 * const txt = renderRobots({
 *   rules: [
 *     { userAgent: '*', allow: '/', disallow: '/admin' },
 *     { userAgent: 'Googlebot', allow: '/' },
 *   ],
 *   sitemap: 'https://example.com/sitemap.xml',
 * })
 * ```
 */
export function renderRobots(robots: RobotsFile): string {
  const sections: string[] = []

  // 규칙들
  const rules = toArray(robots.rules)
  for (const rule of rules) {
    sections.push(renderRule(rule))
  }

  // Host (Yandex 전용)
  if (robots.host) {
    sections.push(`Host: ${robots.host}`)
  }

  // Sitemap
  const sitemaps = toArray(robots.sitemap)
  for (const sitemap of sitemaps) {
    sections.push(`Sitemap: ${sitemap}`)
  }

  return sections.join('\n\n')
}

/**
 * 기본 robots.txt 생성 (모든 크롤러 허용)
 */
export function createDefaultRobots(sitemapUrl?: string): RobotsFile {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: sitemapUrl,
  }
}

/**
 * 개발 환경용 robots.txt 생성 (모든 크롤러 차단)
 */
export function createDevRobots(): RobotsFile {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  }
}
