/**
 * Mandu Kitchen DevTools - Design Tokens
 * @version 1.0.3
 */

// ============================================================================
// Color Tokens
// ============================================================================

// Aligned with mandujs.com brand tokens (app/globals.css + styles/tokens.css):
// primary peach #FF8C66, secondary dark-brown #4A3222, warm-brown dark surfaces
// (#1F1B16/#2A2520/#3E3028), cream text, and the docs-grade semantic palette.
export const colors = {
  brand: {
    primary: '#F5EDE0',      // 만두피 크림 (mandujs cream surface)
    secondary: '#4A3222',    // 구운 다크 브라운 (mandujs --color-secondary)
    accent: '#FF8C66',       // 만두 시그니처 피치 오렌지 (mandujs --color-primary)
  },
  semantic: {
    success: '#6B9E47',      // 올리브 그린 (mandujs --color-success)
    warning: '#E8A93A',      // 웜 앰버 (mandujs --color-warn)
    error: '#C85450',        // 머티드 레드-브라운 (mandujs --color-danger)
    info: '#4A90C2',         // 차분한 블루 (mandujs --color-info)
  },
  background: {
    dark: '#1F1B16',         // 딥 브라운 (mandujs --color-background-dark)
    medium: '#2A2520',       // 웜 서피스 (mandujs --color-surface-dark)
    light: '#3E3028',        // 웜 라이트 서피스 (mandujs --color-dark-surface)
    overlay: 'rgba(20, 14, 8, 0.88)',
  },
  text: {
    primary: '#FFF0E6',      // 웜 크림 화이트 (mandujs --color-dark-text)
    secondary: '#C9BCAD',    // 웜 베이지 그레이
    muted: '#7A6B5D',        // 웜 뮤트 브라운 (mandujs --color-dark-muted)
  },
} as const;

// ============================================================================
// Typography Tokens
// ============================================================================

export const typography = {
  fontFamily: {
    // Aligned with mandujs.com (app/globals.css --font-mono / --font-sans).
    mono: "'Consolas', 'Monaco', 'Ubuntu Mono', 'JetBrains Mono', ui-monospace, monospace",
    sans: "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  fontSize: {
    xs: '10px',
    sm: '12px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

// ============================================================================
// Spacing Tokens
// ============================================================================

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
} as const;

// ============================================================================
// Border Tokens
// ============================================================================

export const borderRadius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export const borderWidth = {
  thin: '1px',
  medium: '2px',
  thick: '4px',
} as const;

// ============================================================================
// Shadow Tokens
// ============================================================================

export const shadows = {
  // Warm-tinted shadows to match the brown-toned dark surfaces.
  sm: '0 1px 3px rgba(20, 12, 4, 0.14)',
  md: '0 4px 8px rgba(20, 12, 4, 0.20)',
  lg: '0 10px 20px rgba(20, 12, 4, 0.26)',
  xl: '0 20px 30px rgba(20, 12, 4, 0.34)',
  overlay: '0 25px 50px rgba(20, 12, 4, 0.5)',
} as const;

// ============================================================================
// Animation Tokens
// ============================================================================

export const animation = {
  duration: {
    fast: '150ms',
    normal: '300ms',
    slow: '500ms',
  },
  easing: {
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
    spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  },
} as const;

// ============================================================================
// Z-Index Tokens
// ============================================================================

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
  devtools: 2147483640,  // 최상위 (max safe - 7)
  overlay: 2147483647,   // 가장 높음 (max safe)
} as const;

// ============================================================================
// Breakpoints
// ============================================================================

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// ============================================================================
// Combined Design Tokens
// ============================================================================

export const ManduDesignTokens = {
  colors,
  typography,
  spacing,
  borderRadius,
  borderWidth,
  shadows,
  animation,
  zIndex,
  breakpoints,
} as const;

export type ManduDesignTokens = typeof ManduDesignTokens;

// ============================================================================
// CSS Variables Generator
// ============================================================================

export function generateCSSVariables(): string {
  return `
    :host {
      /* Colors - Brand */
      --mk-color-brand-primary: ${colors.brand.primary};
      --mk-color-brand-secondary: ${colors.brand.secondary};
      --mk-color-brand-accent: ${colors.brand.accent};

      /* Colors - Semantic */
      --mk-color-success: ${colors.semantic.success};
      --mk-color-warning: ${colors.semantic.warning};
      --mk-color-error: ${colors.semantic.error};
      --mk-color-info: ${colors.semantic.info};

      /* Colors - Background */
      --mk-color-bg-dark: ${colors.background.dark};
      --mk-color-bg-medium: ${colors.background.medium};
      --mk-color-bg-light: ${colors.background.light};
      --mk-color-bg-overlay: ${colors.background.overlay};

      /* Colors - Text */
      --mk-color-text-primary: ${colors.text.primary};
      --mk-color-text-secondary: ${colors.text.secondary};
      --mk-color-text-muted: ${colors.text.muted};

      /* Typography */
      --mk-font-mono: ${typography.fontFamily.mono};
      --mk-font-sans: ${typography.fontFamily.sans};
      --mk-font-size-xs: ${typography.fontSize.xs};
      --mk-font-size-sm: ${typography.fontSize.sm};
      --mk-font-size-md: ${typography.fontSize.md};
      --mk-font-size-lg: ${typography.fontSize.lg};
      --mk-font-size-xl: ${typography.fontSize.xl};

      /* Spacing */
      --mk-space-xs: ${spacing.xs};
      --mk-space-sm: ${spacing.sm};
      --mk-space-md: ${spacing.md};
      --mk-space-lg: ${spacing.lg};
      --mk-space-xl: ${spacing.xl};

      /* Border Radius */
      --mk-radius-sm: ${borderRadius.sm};
      --mk-radius-md: ${borderRadius.md};
      --mk-radius-lg: ${borderRadius.lg};
      --mk-radius-full: ${borderRadius.full};

      /* Shadows */
      --mk-shadow-sm: ${shadows.sm};
      --mk-shadow-md: ${shadows.md};
      --mk-shadow-lg: ${shadows.lg};
      --mk-shadow-overlay: ${shadows.overlay};

      /* Animation */
      --mk-duration-fast: ${animation.duration.fast};
      --mk-duration-normal: ${animation.duration.normal};
      --mk-duration-slow: ${animation.duration.slow};
      --mk-easing-spring: ${animation.easing.spring};

      /* Z-Index */
      --mk-z-devtools: ${zIndex.devtools};
      --mk-z-overlay: ${zIndex.overlay};
    }
  `;
}

// ============================================================================
// Test Selectors (data-testid)
// ============================================================================

export const testIds = {
  host: 'mk-host',
  root: 'mk-root',
  overlay: 'mk-overlay',
  panel: 'mk-panel',
  badge: 'mk-badge',
  tabErrors: 'mk-tab-errors',
  tabIslands: 'mk-tab-islands',
  tabNetwork: 'mk-tab-network',
  tabGuard: 'mk-tab-guard',
  tabPreview: 'mk-tab-preview',
  errorList: 'mk-error-list',
  mandu: 'mk-mandu',
  restartButton: 'mk-restart-button',
} as const;

export type TestId = (typeof testIds)[keyof typeof testIds];
