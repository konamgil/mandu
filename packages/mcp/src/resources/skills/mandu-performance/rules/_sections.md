# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Async Optimization (perf-async)

**Impact:** CRITICAL
**Description:** 워터폴은 성능의 #1 킬러입니다. 순차적 await는 매번 전체 네트워크 지연을 추가합니다. 워터폴 제거가 가장 큰 성능 향상을 가져옵니다.

## 2. Bundle Optimization (perf-bundle)

**Impact:** CRITICAL
**Description:** 초기 번들 크기 감소는 Time to Interactive와 Largest Contentful Paint를 개선합니다. Island lazy loading과 직접 import가 핵심입니다.

## 3. Caching Strategies (perf-cache)

**Impact:** HIGH
**Description:** 적절한 캐싱은 불필요한 연산과 네트워크 요청을 제거합니다. React.cache()는 요청 내 중복 제거, LRU는 요청 간 캐싱에 사용합니다.

## 4. Bun Runtime (perf-bun)

**Impact:** HIGH
**Description:** Bun의 네이티브 API (Bun.serve, Bun.file, bun:sqlite)는 Node.js 대비 현저히 빠릅니다. Mandu는 Bun 기반이므로 이를 최대한 활용해야 합니다.

## 5. Rendering Performance (perf-render)

**Impact:** MEDIUM
**Description:** Island hydration 우선순위 설정과 startTransition 활용으로 사용자 체감 성능을 개선합니다.
