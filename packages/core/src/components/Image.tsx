/**
 * Mandu <Image> Component
 * 서버 사이드 이미지 최적화 — srcset, lazy loading, LCP preload
 */

import React from "react";

// ========== Types ==========

export interface ImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> {
  /** 이미지 소스 경로 (/public 기준) */
  src: string;
  /** alt 텍스트 (필수 — 접근성) */
  alt: string;
  /** 너비 (px) */
  width: number;
  /** 높이 (px) */
  height: number;
  /** 반응형 sizes 속성 */
  sizes?: string;
  /** LCP 이미지 — preload 힌트 삽입 (기본: false) */
  priority?: boolean;
  /** 이미지 품질 (1-100, 기본: 80) */
  quality?: number;
  /** 플레이스홀더 (기본: "empty") */
  placeholder?: "empty" | "blur";
  /** 생성할 srcset 너비 목록 (기본: [640, 750, 828, 1080, 1200]) */
  widths?: number[];
}

// ========== Constants ==========

const DEFAULT_WIDTHS = [640, 750, 828, 1080, 1200];
const IMAGE_HANDLER_PATH = "/_mandu/image";

// ========== Helper ==========

function buildImageUrl(src: string, width: number, quality: number): string {
  return `${IMAGE_HANDLER_PATH}?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}

function buildSrcSet(src: string, widths: number[], quality: number): string {
  return widths
    .map(w => `${buildImageUrl(src, w, quality)} ${w}w`)
    .join(", ");
}

// ========== Component ==========

/**
 * 최적화된 이미지 컴포넌트
 *
 * @example
 * ```tsx
 * import { Image } from "@mandujs/core/compat/components/Image-compat";
 *
 * <Image
 *   src="/photos/hero.jpg"
 *   alt="Hero"
 *   width={800}
 *   height={400}
 *   sizes="(max-width: 768px) 100vw, 800px"
 *   priority
 * />
 * ```
 */
export function Image({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
  quality = 80,
  placeholder = "empty",
  widths = DEFAULT_WIDTHS,
  style,
  ...rest
}: ImageProps) {
  const optimizedSrc = buildImageUrl(src, width, quality);
  const srcSet = buildSrcSet(src, widths, quality);
  const blurPlaceholderSrc = buildImageUrl(src, Math.min(width, 32), Math.max(10, Math.min(quality, 30)));

  const imgStyle: React.CSSProperties = {
    display: "block",
    aspectRatio: `${width}/${height}`,
    maxWidth: "100%",
    height: "auto",
    position: placeholder === "blur" ? "relative" : undefined,
    zIndex: placeholder === "blur" ? 1 : undefined,
    ...style,
  };

  const wrapperStyle: React.CSSProperties | undefined = placeholder === "blur"
    ? {
        position: "relative",
        display: "inline-block",
        overflow: "hidden",
        maxWidth: "100%",
      }
    : undefined;

  const blurPlaceholderStyle: React.CSSProperties | undefined = placeholder === "blur"
    ? {
        position: "absolute",
        inset: 0,
        backgroundImage: `url("${blurPlaceholderSrc}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        filter: "blur(16px)",
        transform: "scale(1.05)",
      }
    : undefined;

  return (
    <>
      {/* React 19: <link> 자동 <head> 호이스팅 지원 */}
      {priority && (
        React.createElement("link", {
          rel: "preload",
          as: "image",
          href: optimizedSrc,
          imageSrcSet: srcSet,
          imageSizes: sizes,
          fetchPriority: "high",
        })
      )}
      {placeholder === "blur" ? (
        <span style={wrapperStyle}>
          <span aria-hidden="true" style={blurPlaceholderStyle} />
          <img
            src={optimizedSrc}
            srcSet={srcSet}
            sizes={sizes ?? `${width}px`}
            alt={alt}
            width={width}
            height={height}
            loading={priority ? "eager" : "lazy"}
            decoding={priority ? "sync" : "async"}
            fetchPriority={priority ? "high" : undefined}
            style={imgStyle}
            {...rest}
          />
        </span>
      ) : (
        <img
          src={optimizedSrc}
          srcSet={srcSet}
          sizes={sizes ?? `${width}px`}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "sync" : "async"}
          fetchPriority={priority ? "high" : undefined}
          style={imgStyle}
          {...rest}
        />
      )}
    </>
  );
}
