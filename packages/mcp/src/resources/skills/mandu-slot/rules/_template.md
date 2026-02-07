# Rule Template

Use this template when creating new rules for mandu-slot.

---

```markdown
---
title: Rule Title Here (명확하고 액션 가능한 제목)
impact: CRITICAL | HIGH | MEDIUM | LOW
impactDescription: 영향 설명 (예: "Required for slot to work", "2-5x improvement")
tags: slot, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

규칙의 목적과 중요성을 1-2문장으로 설명합니다.

**Incorrect (문제점 설명):**

\`\`\`typescript
// 잘못된 예시 코드
export default function handler(req) {
  // 문제가 되는 패턴
}
\`\`\`

**Correct (올바른 방법):**

\`\`\`typescript
// 올바른 예시 코드
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ message: "Hello" });
  });
\`\`\`

## Additional Context (선택사항)

추가 설명이 필요한 경우 여기에 작성합니다.

Reference: [관련 문서 링크](https://example.com)
```

---

## Naming Convention

- 파일명: `{section}-{rule-name}.md`
- 예시: `slot-basic-structure.md`, `slot-ctx-response.md`

## Impact Levels

| Level | When to Use |
|-------|-------------|
| CRITICAL | 없으면 기능이 작동하지 않음 |
| HIGH | 심각한 버그나 보안 문제 유발 |
| MEDIUM | 성능이나 유지보수성에 영향 |
| LOW | 모범 사례, 선택적 개선 |
