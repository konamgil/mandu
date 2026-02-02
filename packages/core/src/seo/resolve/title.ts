/**
 * Mandu SEO - Title Resolution
 *
 * title.template 패턴 처리
 * Layout의 template이 Page의 title에 적용됨
 */

import type { Title, TemplateString, AbsoluteTemplateString, AbsoluteString } from '../types'

/**
 * Title이 TemplateString 객체인지 확인 (default 필드 있음)
 */
function isTemplateString(title: Title): title is TemplateString {
  return typeof title === 'object' && title !== null && 'default' in title
}

/**
 * Title이 AbsoluteString 객체인지 확인 (absolute 필드만 있음, default 없음)
 */
function isAbsoluteString(title: Title): title is AbsoluteString {
  return typeof title === 'object' && title !== null && 'absolute' in title && !('default' in title)
}

/**
 * Title을 AbsoluteTemplateString으로 변환
 */
export function resolveTitle(
  title: Title | null | undefined,
  parentTemplate: string | null
): AbsoluteTemplateString | null {
  if (title === null || title === undefined) {
    return null
  }

  // String title
  if (typeof title === 'string') {
    // 부모 템플릿 적용
    const absolute = parentTemplate
      ? parentTemplate.replace('%s', title)
      : title

    return {
      absolute,
      template: null,
    }
  }

  // AbsoluteString object ({ absolute: string }) - 템플릿 무시
  if (isAbsoluteString(title)) {
    return {
      absolute: title.absolute,
      template: title.template || null,
    }
  }

  // TemplateString object ({ default: string, template?: string })
  if (isTemplateString(title)) {
    // default에 부모 템플릿 적용
    const absolute = parentTemplate
      ? parentTemplate.replace('%s', title.default)
      : title.default

    return {
      absolute,
      template: title.template || null,
    }
  }

  return null
}

/**
 * Layout 체인에서 title template 추출
 */
export function extractTitleTemplate(title: Title | null | undefined): string | null {
  if (!title) return null

  if (typeof title === 'string') {
    return null
  }

  if (isTemplateString(title)) {
    return title.template || null
  }

  return null
}

/**
 * title.absolute 값 추출 (렌더링용)
 */
export function getTitleString(resolved: AbsoluteTemplateString | null): string | null {
  return resolved?.absolute || null
}
