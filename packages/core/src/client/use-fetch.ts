/**
 * Mandu useFetch Composable
 * SSR 데이터 중복 방지 + pending/error 상태 + 클라이언트 캐시
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ========== Types ==========

export interface UseFetchOptions<T = unknown> {
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  /** SSR 데이터 있으면 클라이언트 fetch 생략 (기본: true) */
  dedupe?: boolean;
  /** SSR에서 전달된 초기 데이터 */
  initialData?: T;
  /** 캐시 유지 시간 (ms, 0이면 캐시 안 함) */
  cacheTime?: number;
  /** 자동 실행 여부 (기본: true) */
  immediate?: boolean;
  /** 응답 변환 함수 */
  transform?: (data: unknown) => T;
}

export interface UseFetchReturn<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh: () => Promise<void>;
  mutate: (updater: T | ((prev: T | null) => T)) => void;
}

// ========== Cache (LRU, 최대 200 엔트리) ==========

const MAX_CACHE_SIZE = 200;

interface CacheEntry { data: unknown; timestamp: number; }
const fetchCache = new Map<string, CacheEntry>();

function getCached(key: string, maxAge: number): unknown | undefined {
  const entry = fetchCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > maxAge) {
    fetchCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCache(key: string, data: unknown): void {
  // LRU: 오래된 것부터 제거
  if (fetchCache.size >= MAX_CACHE_SIZE) {
    const oldest = fetchCache.keys().next().value;
    if (oldest !== undefined) fetchCache.delete(oldest);
  }
  fetchCache.set(key, { data, timestamp: Date.now() });
}

function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "object") return String(value);
  // 키를 정렬하여 삽입 순서에 무관한 안정적 직렬화
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

function buildCacheKey(url: string, query?: Record<string, string | number>): string {
  const params = query ? "?" + stableStringify(query) : "";
  return `${url}${params}`;
}

function buildUrl(url: string, query?: Record<string, string | number>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  return `${url}${url.includes("?") ? "&" : "?"}${params.toString()}`;
}

// ========== Hook ==========

/**
 * 데이터 페칭 훅 — SSR 중복 방지, 캐싱, pending/error 상태 관리
 *
 * @example
 * ```tsx
 * const { data, loading, error, refresh } = useFetch<Post[]>("/api/posts", {
 *   query: { page: 1 },
 *   cacheTime: 300_000,
 * });
 *
 * const { data, mutate } = useFetch<Todo[]>("/api/todos");
 * const addTodo = (todo: Todo) => mutate(prev => [...(prev ?? []), todo]);
 * ```
 */
export function useFetch<T = unknown>(
  url: string,
  options?: UseFetchOptions<T>
): UseFetchReturn<T> {
  const {
    query,
    headers,
    method = "GET",
    body,
    dedupe = true,
    initialData,
    cacheTime = 0,
    immediate = true,
    transform,
  } = options ?? {};

  // 안정적 직렬화 — useRef로 이전 값과 비교하여 변경 시에만 갱신
  const queryStr = stableStringify(query);
  const headersStr = stableStringify(headers);
  const bodyStr = stableStringify(body);

  const prevQueryRef = useRef(queryStr);
  const prevHeadersRef = useRef(headersStr);
  const prevBodyRef = useRef(bodyStr);

  const stableQuery = prevQueryRef.current === queryStr ? prevQueryRef.current : (prevQueryRef.current = queryStr);
  const stableHeaders = prevHeadersRef.current === headersStr ? prevHeadersRef.current : (prevHeadersRef.current = headersStr);
  const stableBody = prevBodyRef.current === bodyStr ? prevBodyRef.current : (prevBodyRef.current = bodyStr);

  const cacheKey = `${url}?${stableQuery}`;

  // URL/query 변경 감지
  const prevCacheKeyRef = useRef(cacheKey);

  const [data, setData] = useState<T | null>(() => {
    if (initialData !== undefined) return initialData;
    if (cacheTime > 0) {
      const cached = getCached(cacheKey, cacheTime);
      if (cached !== undefined) return (transform ? transform(cached) : cached) as T;
    }
    return null;
  });
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!data && immediate);
  const abortRef = useRef<AbortController | null>(null);

  // URL/query 변경 시 data 초기화 (useEffect로 React 규칙 준수)
  useEffect(() => {
    if (prevCacheKeyRef.current === cacheKey) return;
    prevCacheKeyRef.current = cacheKey;

    if (cacheTime > 0) {
      const cached = getCached(cacheKey, cacheTime);
      if (cached !== undefined) {
        setData((transform ? transform(cached) : cached) as T);
        return;
      }
    }
    setData(null);
  }, [cacheKey]);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const fetchUrl = buildUrl(url, query);
      const response = await fetch(fetchUrl, {
        method,
        headers: { "Accept": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // Content-Type 확인 후 파싱
      const contentType = response.headers.get("content-type") ?? "";
      let result: unknown;
      if (contentType.includes("application/json")) {
        result = await response.json();
      } else if (response.status === 204) {
        result = null;
      } else {
        result = await response.text();
      }

      if (transform) result = transform(result);
      setData(result as T);

      if (cacheTime > 0) setCache(cacheKey, result);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [url, method, stableQuery, stableHeaders, stableBody, cacheTime, cacheKey]);

  useEffect(() => {
    if (!immediate) return;
    if (data && dedupe) return;
    fetchData();
    return () => { abortRef.current?.abort(); };
  }, [fetchData, immediate, dedupe]);

  const mutate = useCallback((updater: T | ((prev: T | null) => T)) => {
    setData(prev => typeof updater === "function" ? (updater as (prev: T | null) => T)(prev) : updater);
  }, []);

  return { data, error, loading, refresh: fetchData, mutate };
}
