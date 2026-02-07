# Rule Template

Use this template when creating new rules for mandu-hydration.

---

```markdown
---
title: Rule Title Here
impact: CRITICAL | HIGH | MEDIUM | LOW
impactDescription: 영향 설명
tags: hydration, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

규칙의 목적과 중요성을 설명합니다.

**Incorrect (문제점 설명):**

\`\`\`tsx
// 잘못된 예시
import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);  // ❌ "use client" 없음
  return <button>{count}</button>;
}
\`\`\`

**Correct (올바른 방법):**

\`\`\`tsx
// 올바른 예시
"use client";

import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);  // ✅ 작동함
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\`

Reference: [관련 문서 링크](https://example.com)
```

---

## Naming Convention

- 파일명: `{section}-{rule-name}.md`
- 예시: `hydration-directive-use-client.md`, `hydration-island-setup.md`

## Hydration Strategies Quick Reference

| Strategy | JavaScript | Use Case |
|----------|------------|----------|
| `none` | 없음 | 순수 정적 페이지 |
| `island` | 부분 | 정적 + 인터랙티브 혼합 (기본값) |
| `full` | 전체 | SPA 스타일 페이지 |

## Priority Quick Reference

| Priority | Load Time | Use Case |
|----------|-----------|----------|
| `immediate` | 페이지 로드 | 중요한 인터랙션 |
| `visible` | 뷰포트 진입 | 스크롤 아래 콘텐츠 (기본값) |
| `idle` | 브라우저 유휴 | 비중요 기능 |
| `interaction` | 사용자 액션 | 클릭해야 활성화 |
