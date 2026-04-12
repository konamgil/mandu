/**
 * Mandu useHead / useSeoMeta
 * SSR + 클라이언트에서 <head> 태그를 선언적으로 관리
 */

import { useEffect, useRef } from "react";

// ========== Types ==========

export interface HeadTag {
  tag: "title" | "meta" | "link" | "script" | "style";
  attrs?: Record<string, string>;
  children?: string;
}

export interface HeadConfig {
  title?: string;
  meta?: Array<{ name?: string; property?: string; content: string; httpEquiv?: string }>;
  link?: Array<{ rel: string; href: string; [key: string]: string }>;
}

export interface SeoMetaConfig {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: string;
  twitterCard?: "summary" | "summary_large_image" | "app" | "player";
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  canonical?: string;
  robots?: string;
}

// ========== SSR Head Collection ==========

/** SSR 렌더링 중 수집된 head 태그 */
let ssrHeadTags: string[] = [];
let isSSR = typeof window === "undefined";

/** SSR 렌더링 전 초기화 */
export function resetSSRHead(): void {
  ssrHeadTags = [];
}

/** SSR 렌더링 후 수집된 head 태그 반환 */
export function getSSRHeadTags(): string {
  return ssrHeadTags.join("\n");
}

function pushSSRTag(html: string): void {
  if (isSSR) {
    ssrHeadTags.push(html);
  }
}

// ========== Client-side DOM Management ==========

const managedElements = new Set<Element>();

function updateClientHead(tags: HeadTag[]): void {
  if (typeof document === "undefined") return;

  // 이전 managed 태그 제거
  for (const el of managedElements) {
    el.remove();
  }
  managedElements.clear();

  // 새 태그 삽입
  for (const tag of tags) {
    if (tag.tag === "title") {
      document.title = tag.children ?? "";
      continue;
    }

    const el = document.createElement(tag.tag);
    if (tag.attrs) {
      for (const [key, value] of Object.entries(tag.attrs)) {
        el.setAttribute(key, value);
      }
    }
    if (tag.children) {
      el.textContent = tag.children;
    }
    el.setAttribute("data-mandu-head", "");
    document.head.appendChild(el);
    managedElements.add(el);
  }
}

// ========== Hooks ==========

/**
 * 선언적 <head> 태그 관리
 *
 * @example
 * ```tsx
 * useHead({
 *   title: "My Page",
 *   meta: [{ name: "description", content: "Page description" }],
 *   link: [{ rel: "canonical", href: "https://example.com/page" }],
 * });
 * ```
 */
export function useHead(config: HeadConfig): void {
  const tags: HeadTag[] = [];

  if (config.title) {
    tags.push({ tag: "title", children: config.title });
    // SSR: title은 별도 처리 (renderToHTML의 title 옵션 대신)
    pushSSRTag(`<title>${escapeHtml(config.title)}</title>`);
  }

  if (config.meta) {
    for (const meta of config.meta) {
      const attrs: Record<string, string> = { content: meta.content };
      if (meta.name) attrs.name = meta.name;
      if (meta.property) attrs.property = meta.property;
      if (meta.httpEquiv) attrs["http-equiv"] = meta.httpEquiv;
      tags.push({ tag: "meta", attrs });
      pushSSRTag(`<meta ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(" ")}>`);
    }
  }

  if (config.link) {
    for (const link of config.link) {
      tags.push({ tag: "link", attrs: link });
      pushSSRTag(`<link ${Object.entries(link).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(" ")}>`);
    }
  }

  // 클라이언트: DOM 업데이트
  const prevTagsRef = useRef<HeadTag[]>([]);

  useEffect(() => {
    prevTagsRef.current = tags;
    updateClientHead(tags);

    return () => {
      // unmount 시 정리
      for (const el of managedElements) {
        el.remove();
      }
      managedElements.clear();
    };
  }, [JSON.stringify(config)]);
}

/**
 * SEO 메타 태그 전용 — 간편 API
 *
 * @example
 * ```tsx
 * useSeoMeta({
 *   title: "Blog Post Title",
 *   description: "Post excerpt...",
 *   ogTitle: "Blog Post Title",
 *   ogImage: "/images/cover.jpg",
 *   twitterCard: "summary_large_image",
 * });
 * ```
 */
export function useSeoMeta(config: SeoMetaConfig): void {
  const headConfig: HeadConfig = {
    meta: [],
    link: [],
  };

  if (config.title) headConfig.title = config.title;
  if (config.description) headConfig.meta!.push({ name: "description", content: config.description });
  if (config.robots) headConfig.meta!.push({ name: "robots", content: config.robots });

  // Open Graph
  if (config.ogTitle) headConfig.meta!.push({ property: "og:title", content: config.ogTitle });
  if (config.ogDescription) headConfig.meta!.push({ property: "og:description", content: config.ogDescription });
  if (config.ogImage) headConfig.meta!.push({ property: "og:image", content: config.ogImage });
  if (config.ogUrl) headConfig.meta!.push({ property: "og:url", content: config.ogUrl });
  if (config.ogType) headConfig.meta!.push({ property: "og:type", content: config.ogType });

  // Twitter
  if (config.twitterCard) headConfig.meta!.push({ name: "twitter:card", content: config.twitterCard });
  if (config.twitterTitle) headConfig.meta!.push({ name: "twitter:title", content: config.twitterTitle });
  if (config.twitterDescription) headConfig.meta!.push({ name: "twitter:description", content: config.twitterDescription });
  if (config.twitterImage) headConfig.meta!.push({ name: "twitter:image", content: config.twitterImage });

  // Canonical
  if (config.canonical) headConfig.link!.push({ rel: "canonical", href: config.canonical });

  useHead(headConfig);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
