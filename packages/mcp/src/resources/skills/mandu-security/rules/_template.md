# Rule Template

Use this template when creating new rules for mandu-security.

---

```markdown
---
title: Rule Title Here
impact: CRITICAL | HIGH | MEDIUM | LOW
impactDescription: 영향 설명 (예: "Prevents unauthorized access")
tags: security, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

보안 규칙의 목적과 중요성을 설명합니다.

**Vulnerable (취약한 코드):**

\`\`\`typescript
// ❌ 보안 취약점이 있는 코드
export default Mandu.filling()
  .get(async (ctx) => {
    // 인증 없이 민감 데이터 반환
    const users = await db.user.findMany();
    return ctx.ok({ users });
  });
\`\`\`

**Secure (안전한 코드):**

\`\`\`typescript
// ✅ 보안이 강화된 코드
export default Mandu.filling()
  .guard((ctx) => {
    if (!ctx.get("user")?.isAdmin) {
      return ctx.forbidden("Admin access required");
    }
  })
  .get(async (ctx) => {
    const users = await db.user.findMany();
    return ctx.ok({ users });
  });
\`\`\`

## Attack Vector

이 취약점이 어떻게 악용될 수 있는지 설명합니다.

## Mitigation

추가적인 방어 방법을 설명합니다.

Reference: [OWASP 관련 문서](https://owasp.org/)
```

---

## Naming Convention

- 파일명: `sec-{category}-{rule-name}.md`
- 예시: `sec-auth-guard.md`, `sec-input-validate.md`

## OWASP Top 10 Reference

| # | Category | Related Rules |
|---|----------|---------------|
| 1 | Broken Access Control | sec-auth-* |
| 2 | Cryptographic Failures | sec-data-* |
| 3 | Injection | sec-input-* |
| 7 | XSS | sec-protect-xss |
