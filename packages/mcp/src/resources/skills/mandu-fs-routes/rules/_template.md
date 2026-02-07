# Rule Template

Use this template when creating new rules for mandu-fs-routes.

---

```markdown
---
title: Rule Title Here
impact: CRITICAL | HIGH | MEDIUM | LOW
impactDescription: 영향 설명
tags: routes, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

규칙의 목적과 중요성을 설명합니다.

**Incorrect (문제점 설명):**

\`\`\`
app/
├── about/
│   └── About.tsx      ❌ 인식되지 않음
└── users/
    └── index.tsx      ❌ 인식되지 않음
\`\`\`

**Correct (올바른 구조):**

\`\`\`
app/
├── about/
│   └── page.tsx       ✅ → /about
└── users/
    └── page.tsx       ✅ → /users
\`\`\`

## Code Example

\`\`\`tsx
// app/about/page.tsx

export default function AboutPage() {
  return <h1>About Us</h1>;
}
\`\`\`

Reference: [관련 문서 링크](https://example.com)
```

---

## Naming Convention

- 파일명: `{section}-{rule-name}.md`
- 예시: `routes-naming-page.md`, `routes-dynamic-param.md`

## URL Mapping Quick Reference

| File Path | URL |
|-----------|-----|
| `app/page.tsx` | `/` |
| `app/about/page.tsx` | `/about` |
| `app/users/[id]/page.tsx` | `/users/:id` |
| `app/api/users/route.ts` | `/api/users` |
| `app/(auth)/login/page.tsx` | `/login` |
