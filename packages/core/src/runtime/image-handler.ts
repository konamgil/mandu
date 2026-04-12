/**
 * Mandu Image Handler
 * /_mandu/image?url=...&w=...&q=... 엔드포인트
 * 온디맨드 리사이즈 + WebP/AVIF 포맷 협상 + 캐시
 */

import path from "path";

// ========== Types ==========

interface ImageOptions {
  width: number;
  quality: number;
  format: "webp" | "jpeg" | "png" | "avif";
}

// ========== Cache ==========

const imageCache = new Map<string, { data: Uint8Array; contentType: string }>();
const MAX_IMAGE_CACHE = 500;

// ========== Handler ==========

/**
 * 이미지 최적화 요청 처리
 * /_mandu/image?url=/photos/hero.jpg&w=800&q=80
 */
export async function handleImageRequest(
  request: Request,
  rootDir: string,
  publicDir: string = "public"
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/_mandu/image") return null;

  const src = url.searchParams.get("url");
  const width = Number(url.searchParams.get("w") ?? 800);
  const quality = Number(url.searchParams.get("q") ?? 80);

  if (!src || width < 1 || width > 4096 || quality < 1 || quality > 100) {
    return new Response("Invalid image parameters", { status: 400 });
  }

  // 보안: src가 /로 시작하고 traversal/null byte 없는지 확인
  if (!src.startsWith("/") || src.includes("..") || src.includes("\0")) {
    return new Response("Invalid image path", { status: 400 });
  }

  // 포맷 협상 (Accept 헤더 기반)
  const format = negotiateFormat(request);
  const cacheKey = `${src}:${width}:${quality}:${format}`;

  // 캐시 확인
  const cached = imageCache.get(cacheKey);
  if (cached) {
    return new Response(cached.data as unknown as BodyInit, {
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Vary": "Accept",
        "X-Mandu-Image-Cache": "HIT",
      },
    });
  }

  // 원본 파일 경로 해석 + symlink traversal 방지
  const allowedBaseDir = path.resolve(rootDir, publicDir);
  const filePath = path.join(allowedBaseDir, src.slice(1));

  // realpath로 symlink를 해석한 후 allowedBaseDir 내부인지 검증
  let resolvedPath: string;
  try {
    const realFs = require("fs") as typeof import("fs");
    resolvedPath = realFs.realpathSync(filePath);
    const resolvedBase = realFs.realpathSync(allowedBaseDir);
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      return new Response("Forbidden", { status: 403 });
    }
  } catch {
    // realpath 실패 = 파일 없음 → 아래 exists 체크에서 404 반환
    resolvedPath = filePath;
  }
  const file = Bun.file(resolvedPath);

  if (!await file.exists()) {
    return new Response("Image not found", { status: 404 });
  }

  try {
    const original = await file.arrayBuffer();
    const optimized = await processImage(new Uint8Array(original), { width, quality, format });

    const contentType = `image/${format}`;

    // 캐시 저장 (LRU)
    if (imageCache.size >= MAX_IMAGE_CACHE) {
      const oldest = imageCache.keys().next().value;
      if (oldest !== undefined) imageCache.delete(oldest);
    }
    imageCache.set(cacheKey, { data: optimized, contentType });

    return new Response(optimized as unknown as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Vary": "Accept",
      },
    });
  } catch (error) {
    console.error(`[Mandu Image] Processing failed for ${src}:`, error);
    // 원본 파일 그대로 반환 (fallback)
    return new Response(file, {
      headers: {
        "Content-Type": getMimeForExtension(src),
        "Cache-Control": "public, max-age=86400",
      },
    });
  }
}

// ========== Format Negotiation ==========

function negotiateFormat(request: Request): "webp" | "jpeg" | "png" | "avif" {
  const accept = request.headers.get("Accept") ?? "";
  if (accept.includes("image/avif")) return "avif";
  if (accept.includes("image/webp")) return "webp";
  return "jpeg";
}

function getMimeForExtension(src: string): string {
  const ext = path.extname(src).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".gif": "image/gif",
    ".webp": "image/webp", ".avif": "image/avif",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}

// ========== Image Processing ==========

/**
 * 이미지 리사이즈 + 포맷 변환
 * Bun의 내장 sharp 미지원 시 원본 반환 (graceful degradation)
 */
async function processImage(
  data: Uint8Array,
  options: ImageOptions
): Promise<Uint8Array> {
  // sharp 사용 시도 (선택적 의존성)
  try {
    const sharp = require("sharp") as any;
    let pipeline = sharp(Buffer.from(data)).resize(options.width);

    switch (options.format) {
      case "webp":
        pipeline = pipeline.webp({ quality: options.quality });
        break;
      case "avif":
        pipeline = pipeline.avif({ quality: options.quality });
        break;
      case "jpeg":
        pipeline = pipeline.jpeg({ quality: options.quality });
        break;
      case "png":
        pipeline = pipeline.png({ quality: options.quality });
        break;
    }

    const result = await pipeline.toBuffer();
    return new Uint8Array(result);
  } catch {
    // sharp 미설치 시 원본 반환
    return data;
  }
}
