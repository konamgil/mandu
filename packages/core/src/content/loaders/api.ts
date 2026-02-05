/**
 * API Loader - HTTP API에서 콘텐츠 로드
 *
 * REST API, GraphQL, CMS 등에서 데이터를 가져옴
 *
 * @example
 * ```ts
 * api({
 *   url: 'https://api.example.com/products',
 *   headers: () => ({ Authorization: `Bearer ${token}` }),
 *   transform: (res) => res.data.items,
 * })
 * ```
 */

import type { Loader, ApiLoaderOptions } from "./types";
import type { LoaderContext } from "../types";
import { LoaderError } from "../types";
import { generateDigest } from "../digest";
import { CONTENT } from "../../constants";

/**
 * API Loader 팩토리
 */
export function api(options: ApiLoaderOptions): Loader {
  const {
    url,
    method = "GET",
    headers,
    body,
    transform,
    cacheTTL = CONTENT.API_CACHE_TTL,
    pagination,
  } = options;

  return {
    name: "api",

    async load(context: LoaderContext): Promise<void> {
      const { store, meta, logger, parseData } = context;

      // URL 해결
      const resolvedUrl = typeof url === "function" ? await url() : url;

      // 캐시 확인
      const lastFetch = meta.get("lastFetch");
      const cachedDigest = meta.get("digest");
      const now = Date.now();

      if (lastFetch && cachedDigest) {
        const elapsed = (now - parseInt(lastFetch, 10)) / 1000;
        if (elapsed < cacheTTL) {
          logger.debug(`Cache valid (${Math.round(cacheTTL - elapsed)}s remaining)`);
          return;
        }
      }

      // 헤더 해결
      const resolvedHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(typeof headers === "function" ? await headers() : headers),
      };

      // 바디 해결
      const resolvedBody =
        method === "POST" && body
          ? JSON.stringify(typeof body === "function" ? await body() : body)
          : undefined;

      try {
        // 데이터 가져오기 (페이지네이션 지원)
        const allItems = await fetchWithPagination(
          resolvedUrl,
          {
            method,
            headers: resolvedHeaders,
            body: resolvedBody,
          },
          pagination,
          transform,
          logger
        );

        // 전체 데이터의 다이제스트
        const newDigest = generateDigest(allItems);

        // 변경 없으면 스킵
        if (cachedDigest === newDigest) {
          meta.set("lastFetch", String(now));
          logger.debug("Data unchanged");
          return;
        }

        // 기존 ID 수집
        const existingIds = new Set(store.keys());
        const processedIds = new Set<string>();

        // 각 아이템 처리
        for (const item of allItems) {
          // ID 추출 (id 또는 _id 필드 사용)
          const rawItem = item as Record<string, unknown>;
          const id = String(
            rawItem.id ?? rawItem._id ?? rawItem.slug ?? generateDigest(item).slice(0, 8)
          );

          processedIds.add(id);

          // 검증
          const data = await parseData({
            id,
            data: rawItem,
          });

          // 저장
          store.set({
            id,
            data: data as Record<string, unknown>,
            digest: generateDigest(data),
          });
        }

        // 삭제된 항목 제거
        for (const id of existingIds) {
          if (!processedIds.has(id)) {
            store.delete(id);
          }
        }

        // 메타데이터 업데이트
        meta.set("lastFetch", String(now));
        meta.set("digest", newDigest);
        meta.set("itemCount", String(allItems.length));

        logger.info(`Fetched ${allItems.length} items from API`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LoaderError(`API request failed: ${message}`, context.collection);
      }
    },
  };
}

/**
 * 페이지네이션 지원 fetch
 */
async function fetchWithPagination(
  initialUrl: string,
  fetchOptions: RequestInit,
  pagination: ApiLoaderOptions["pagination"],
  transform: ApiLoaderOptions["transform"],
  logger: { debug: (msg: string) => void }
): Promise<unknown[]> {
  const allItems: unknown[] = [];
  let currentUrl: string | null = initialUrl;
  let pageCount = 0;
  const maxPages = 100; // 안전 장치

  while (currentUrl && pageCount < maxPages) {
    pageCount++;
    logger.debug(`Fetching page ${pageCount}: ${currentUrl}`);

    const response = await fetch(currentUrl, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rawData = await response.json();

    // 변환 적용
    const items = transform ? await transform(rawData) : extractItems(rawData);

    if (!Array.isArray(items)) {
      throw new Error(
        "API response must be an array or transform must return an array"
      );
    }

    allItems.push(...items);

    // 다음 페이지 확인
    if (pagination?.getNextUrl) {
      currentUrl = pagination.getNextUrl(rawData, currentUrl);
    } else {
      currentUrl = null;
    }
  }

  return allItems;
}

/**
 * 기본 아이템 추출 (배열 또는 data 필드)
 */
function extractItems(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;

    // 일반적인 API 응답 구조
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.records)) return obj.records;
    if (Array.isArray(obj.entries)) return obj.entries;

    // 단일 객체를 배열로
    return [data];
  }

  return [];
}
