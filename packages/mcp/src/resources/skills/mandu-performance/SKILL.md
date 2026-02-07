---
name: mandu-performance
description: |
  Performance optimization patterns for Mandu applications. Use when optimizing
  slot handlers, Island components, bundle size, or Bun runtime. Triggers on
  tasks involving async/await, Promise.all, lazy loading, caching, or performance.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Performance

Mandu 애플리케이션의 성능 최적화 가이드. 워터폴 제거, 번들 최적화, 캐싱 패턴, Bun 런타임 활용법을 다룹니다. Vercel의 React Best Practices를 Mandu 컨텍스트로 변환하여 적용합니다.

## When to Apply

Reference these guidelines when:
- Optimizing slot handler response times
- Reducing Island component bundle size
- Implementing caching strategies
- Working with async/await patterns
- Leveraging Bun runtime features

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Async Optimization | CRITICAL | `perf-async-` |
| 2 | Bundle Optimization | CRITICAL | `perf-bundle-` |
| 3 | Caching Strategies | HIGH | `perf-cache-` |
| 4 | Bun Runtime | HIGH | `perf-bun-` |
| 5 | Rendering | MEDIUM | `perf-render-` |

## Quick Reference

### 1. Async Optimization (CRITICAL)

- `perf-async-parallel` - Use Promise.all() for independent operations
- `perf-async-defer-await` - Move await into branches where actually used
- `perf-async-early-start` - Start promises early, await late

### 2. Bundle Optimization (CRITICAL)

- `perf-bundle-imports` - Import directly, avoid barrel files
- `perf-bundle-island-lazy` - Lazy load Islands with dynamic import
- `perf-bundle-preload` - Preload on hover/focus for perceived speed

### 3. Caching Strategies (HIGH)

- `perf-cache-slot` - Cache slot responses with appropriate TTL
- `perf-cache-react` - Use React.cache() for request deduplication
- `perf-cache-lru` - Use LRU cache for cross-request caching

### 4. Bun Runtime (HIGH)

- `perf-bun-serve` - Optimize Bun.serve() configuration
- `perf-bun-file` - Use Bun.file() for efficient file operations
- `perf-bun-sqlite` - Leverage bun:sqlite for fast database access

### 5. Rendering (MEDIUM)

- `perf-render-island-priority` - Set appropriate hydration priority
- `perf-render-transitions` - Use startTransition for non-urgent updates

## Performance Impact Summary

| Optimization | Typical Improvement |
|--------------|---------------------|
| Promise.all() | 2-10× faster |
| Direct imports | 15-70% faster dev boot |
| Island lazy loading | 40-60% smaller initial bundle |
| React.cache() | Eliminates duplicate queries |
| Bun.file() | 10× faster than Node fs |

## How to Use

Read individual rule files for detailed explanations:

```
rules/perf-async-parallel.md
rules/perf-bundle-imports.md
rules/perf-bun-serve.md
```
