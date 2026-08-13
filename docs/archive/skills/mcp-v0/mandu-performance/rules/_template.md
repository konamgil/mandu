# Rule Template

Use this template when creating new rules for mandu-performance.

---

```markdown
---
title: Rule Title Here
impact: CRITICAL | HIGH | MEDIUM | LOW
impactDescription: 개선 수치 (예: "2-10× improvement", "40% faster")
tags: performance, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

규칙의 목적과 성능 영향을 설명합니다.

**Incorrect (문제점 - 성능 영향 명시):**

\`\`\`typescript
// ❌ 순차 실행: 3번의 네트워크 왕복
const user = await fetchUser();
const posts = await fetchPosts();
const comments = await fetchComments();
// 총 시간: 100ms + 100ms + 100ms = 300ms
\`\`\`

**Correct (해결책 - 성능 개선 명시):**

\`\`\`typescript
// ✅ 병렬 실행: 1번의 네트워크 왕복
const [user, posts, comments] = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments(),
]);
// 총 시간: max(100ms, 100ms, 100ms) = 100ms
\`\`\`

## Mandu Context

Mandu에서 이 규칙을 적용하는 구체적인 방법을 설명합니다.

Reference: [관련 문서 링크](https://example.com)
```

---

## Naming Convention

- 파일명: `perf-{category}-{rule-name}.md`
- 예시: `perf-async-parallel.md`, `perf-bundle-imports.md`

## Impact Measurement

| Level | Typical Improvement |
|-------|---------------------|
| CRITICAL | 2-10× or 50%+ |
| HIGH | 20-50% |
| MEDIUM | 10-20% |
| LOW | < 10% |
