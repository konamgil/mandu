import type { BunFile } from "bun";
import path from "path";
import fs from "fs/promises";

export interface StaticFileSettings {
  isDev: boolean;
  rootDir: string;
  publicDir: string;
}

export interface StaticFileResult {
  handled: boolean;
  response?: Response;
}

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "application/typescript",
  ".css": "text/css",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

const PUBLIC_FLAT_ASSET_EXTENSIONS = new Set<string>([
  ".webp", ".avif", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
  ".pdf", ".zip", ".mp4", ".webm", ".mp3", ".wav",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".css", ".js", ".map",
]);

interface EtagCacheEntry {
  size: number;
  mtime: number;
  etag: string;
}

const etagCache = new Map<string, EtagCacheEntry>();
const ETAG_CACHE_MAX = 2048;

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function hasContentHashInFilename(filename: string): boolean {
  return /[.\-][a-f0-9]{8,}\.[a-z0-9]+$/i.test(filename);
}

export function computeStaticCacheControl(filename: string, isDev: boolean): string {
  if (isDev) return "no-cache, no-store, must-revalidate";
  if (hasContentHashInFilename(filename)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=0, must-revalidate";
}

function evictEtagCacheIfNeeded(): void {
  if (etagCache.size <= ETAG_CACHE_MAX) return;
  const oldestKey = etagCache.keys().next().value;
  if (oldestKey !== undefined) etagCache.delete(oldestKey);
}

export async function computeStrongEtag(
  filePath: string,
  file: BunFile,
): Promise<string> {
  const size = file.size;
  const mtime = file.lastModified;

  const cached = etagCache.get(filePath);
  if (cached && cached.size === size && cached.mtime === mtime) {
    return cached.etag;
  }

  let digest: string;
  try {
    const bytes = await file.arrayBuffer();
    const hash = Bun.hash(bytes);
    digest = typeof hash === "bigint" ? hash.toString(36) : Number(hash).toString(36);
  } catch {
    digest = `${size.toString(36)}-${mtime.toString(36)}`;
  }

  const etag = `"${digest}"`;
  etagCache.set(filePath, { size, mtime, etag });
  evictEtagCacheIfNeeded();
  return etag;
}

export function __clearStaticEtagCacheForTests(): void {
  etagCache.clear();
}

export function matchesEtag(ifNoneMatch: string, currentEtag: string): boolean {
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") return true;

  const normalize = (tag: string): string => {
    const next = tag.trim();
    return next.startsWith("W/") ? next.slice(2) : next;
  };

  const currentNormalized = normalize(currentEtag);
  for (const part of trimmed.split(",")) {
    if (normalize(part) === currentNormalized) return true;
  }
  return false;
}

async function isPathSafe(filePath: string, allowedDir: string): Promise<boolean> {
  try {
    const resolvedPath = path.resolve(filePath);
    const resolvedAllowedDir = path.resolve(allowedDir);

    if (
      !resolvedPath.startsWith(resolvedAllowedDir + path.sep) &&
      resolvedPath !== resolvedAllowedDir
    ) {
      return false;
    }

    try {
      await fs.access(resolvedPath);
    } catch {
      return true;
    }

    const realPath = await fs.realpath(resolvedPath);
    const realAllowedDir = await fs.realpath(resolvedAllowedDir);

    return realPath.startsWith(realAllowedDir + path.sep) ||
      realPath === realAllowedDir;
  } catch (error) {
    console.warn(`[Mandu Security] Path validation failed: ${filePath}`, error);
    return false;
  }
}

function createStaticErrorResponse(status: 400 | 403 | 404 | 500): Response {
  const body = {
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
  }[status];

  return new Response(body, { status });
}

export async function serveStaticFile(
  pathname: string,
  settings: StaticFileSettings,
  request?: Request,
): Promise<StaticFileResult> {
  let filePath: string | null = null;
  let isBundleFile = false;
  let isPublicFlatFallback = false;
  let allowRouteFallbackOnMissing = false;
  let allowedBaseDir: string;
  let relativePath: string;

  if (pathname.startsWith("/.mandu/client/")) {
    relativePath = pathname.slice("/.mandu/client/".length);
    allowedBaseDir = path.join(settings.rootDir, ".mandu", "client");
    isBundleFile = true;
  } else if (pathname.startsWith("/public/")) {
    relativePath = pathname.slice("/public/".length);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
  } else if (pathname.startsWith("/.well-known/")) {
    relativePath = pathname.slice(1);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
  } else if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json"
  ) {
    relativePath = path.basename(pathname);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
    allowRouteFallbackOnMissing = true;
  } else if (PUBLIC_FLAT_ASSET_EXTENSIONS.has(path.extname(pathname).toLowerCase())) {
    relativePath = pathname.slice(1);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
    isPublicFlatFallback = true;
  } else {
    return { handled: false };
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return { handled: true, response: createStaticErrorResponse(400) };
  }

  const normalizedPath = path.posix.normalize(decodedPath);
  if (normalizedPath.includes("\0")) {
    console.warn(`[Mandu Security] Null byte attack detected: ${pathname}`);
    return { handled: true, response: createStaticErrorResponse(400) };
  }

  const normalizedSegments = normalizedPath.split("/");
  if (normalizedSegments.some((segment) => segment === "..")) {
    return { handled: true, response: createStaticErrorResponse(403) };
  }

  const safeRelativePath = normalizedPath.replace(/^\/+/, "");
  filePath = path.join(allowedBaseDir, safeRelativePath);

  if (!(await isPathSafe(filePath, allowedBaseDir))) {
    console.warn(`[Mandu Security] Path traversal attempt blocked: ${pathname}`);
    return { handled: true, response: createStaticErrorResponse(403) };
  }

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      if (isPublicFlatFallback || allowRouteFallbackOnMissing) return { handled: false };
      return { handled: true, response: createStaticErrorResponse(404) };
    }

    const mimeType = getMimeType(filePath);
    const filename = path.basename(filePath);
    let cacheControl: string;
    if (settings.isDev) {
      cacheControl = "no-cache, no-store, must-revalidate";
    } else if (isBundleFile) {
      cacheControl = computeStaticCacheControl(filename, false);
    } else {
      cacheControl = "public, max-age=86400";
    }

    const etag = isBundleFile
      ? await computeStrongEtag(filePath, file)
      : `W/"${file.size.toString(36)}-${file.lastModified.toString(36)}"`;

    const ifNoneMatch = request?.headers.get("If-None-Match");
    if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
      return {
        handled: true,
        response: new Response(null, {
          status: 304,
          headers: { "ETag": etag, "Cache-Control": cacheControl },
        }),
      };
    }

    return {
      handled: true,
      response: new Response(file, {
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": cacheControl,
          "ETag": etag,
        },
      }),
    };
  } catch {
    return { handled: true, response: createStaticErrorResponse(500) };
  }
}
