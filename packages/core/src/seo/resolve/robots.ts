/**
 * Mandu SEO - Robots Resolution
 *
 * robots 메타 태그 값 생성
 */

import type { Robots, ResolvedRobots } from '../types'

/**
 * Robots 객체를 문자열로 변환
 */
function robotsToString(robots: Robots): string {
  const values: string[] = []

  // Boolean directives
  if (robots.index === true) values.push('index')
  if (robots.index === false) values.push('noindex')
  if (robots.follow === true) values.push('follow')
  if (robots.follow === false) values.push('nofollow')
  if (robots.noarchive) values.push('noarchive')
  if (robots.nosnippet) values.push('nosnippet')
  if (robots.noimageindex) values.push('noimageindex')
  if (robots.nocache) values.push('nocache')
  if (robots.notranslate) values.push('notranslate')

  // Numeric directives
  if (robots['max-snippet'] !== undefined) {
    values.push(`max-snippet:${robots['max-snippet']}`)
  }
  if (robots['max-image-preview']) {
    values.push(`max-image-preview:${robots['max-image-preview']}`)
  }
  if (robots['max-video-preview'] !== undefined) {
    values.push(`max-video-preview:${robots['max-video-preview']}`)
  }

  return values.join(', ')
}

/**
 * Robots 설정 해석
 */
export function resolveRobots(
  robots: string | Robots | null | undefined
): ResolvedRobots | null {
  if (!robots) return null

  // 문자열 그대로 사용
  if (typeof robots === 'string') {
    return {
      basic: robots,
      googleBot: null,
    }
  }

  // 객체에서 문자열 생성
  const basicString = robotsToString(robots)

  return {
    basic: basicString || null,
    googleBot: null, // 향후 googleBot 별도 설정 지원
  }
}

/**
 * 기본 robots 값 생성 (index, follow)
 */
export function getDefaultRobots(): ResolvedRobots {
  return {
    basic: 'index, follow',
    googleBot: null,
  }
}
