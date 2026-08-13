# Rule Template

Use this template when creating new rules for mandu-guard.

---

```markdown
---
title: Rule Title Here
impact: CRITICAL | HIGH | MEDIUM | LOW
impactDescription: 영향 설명
tags: guard, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

규칙의 목적과 중요성을 설명합니다.

**Incorrect (위반 예시):**

\`\`\`typescript
// ❌ entities → features (역방향 의존)
// src/entities/user/index.ts
import { useAuth } from "@/features/auth";  // VIOLATION!

export function User() {
  const { isLoggedIn } = useAuth();
}
\`\`\`

**Correct (올바른 방향):**

\`\`\`typescript
// ✅ features → entities (순방향 의존)
// src/features/auth/index.ts
import { User } from "@/entities/user";

export function useAuth() {
  const user = getCurrentUser();
  return { user, isLoggedIn: !!user };
}
\`\`\`

## CLI Command

\`\`\`bash
bunx mandu guard arch --ci
\`\`\`

Reference: [관련 문서 링크](https://example.com)
```

---

## Naming Convention

- 파일명: `{section}-{rule-name}.md`
- 예시: `guard-layer-direction.md`, `guard-preset-mandu.md`

## Layer Hierarchy Quick Reference

### Frontend (FSD)
```
app → pages → widgets → features → entities → shared
```

### Backend (Clean)
```
api → application → domain → infra → core → shared
```

## Rule IDs Quick Reference

| Rule ID | Description |
|---------|-------------|
| `LAYER_VIOLATION` | 레이어 의존성 위반 |
| `GENERATED_DIRECT_EDIT` | generated 파일 직접 수정 |
| `WRONG_SLOT_LOCATION` | 잘못된 slot 파일 위치 |
| `SLOT_NAMING` | slot 파일 이름 규칙 위반 |
| `FORBIDDEN_IMPORT` | 금지된 import |
