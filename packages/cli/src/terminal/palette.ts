/**
 * DNA-009: Mandu Color Palette
 *
 * Inspired by OpenClaw's "Lobster Seam" palette
 * @see https://github.com/dominikwilkowski/cfonts
 */

/**
 * Mandu 브랜드 색상 팔레트
 * 분홍색 기반의 따뜻한 톤
 */
export const MANDU_PALETTE = {
  // 브랜드 컬러 (만두 분홍)
  accent: "#E8B4B8",
  accentBright: "#F5D0D3",
  accentDim: "#C9A0A4",

  // 시맨틱 컬러
  info: "#87CEEB", // 스카이 블루
  success: "#90EE90", // 라이트 그린
  warn: "#FFD700", // 골드
  error: "#FF6B6B", // 코랄 레드

  // 뉴트럴
  muted: "#9CA3AF", // 그레이
  dim: "#6B7280", // 다크 그레이
  text: "#F9FAFB", // 화이트
} as const;

export type ManduColor = keyof typeof MANDU_PALETTE;
