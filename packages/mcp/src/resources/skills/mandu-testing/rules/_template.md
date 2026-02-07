# Rule Template

Use this template when creating new rules for mandu-testing.

---

```markdown
---
title: Rule Title Here
impact: HIGH | MEDIUM | LOW
impactDescription: 영향 설명 (예: "Ensures API correctness")
tags: testing, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

테스트 규칙의 목적과 중요성을 설명합니다.

**Test Example:**

\`\`\`typescript
import { describe, it, expect } from "bun:test";
import userSlot from "./user.slot";

describe("User Slot", () => {
  it("should return user by id", async () => {
    const ctx = createMockContext({
      params: { id: "1" },
    });

    const response = await userSlot.handlers.get(ctx);

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe("1");
  });
});
\`\`\`

## Test Structure

테스트 구조와 네이밍 컨벤션을 설명합니다.

## Common Patterns

자주 사용되는 테스트 패턴을 설명합니다.

Reference: [Bun Test Docs](https://bun.sh/docs/cli/test)
```

---

## Naming Convention

- 파일명: `test-{category}-{rule-name}.md`
- 예시: `test-slot-unit.md`, `test-e2e-playwright.md`

## Test File Location

| Type | Location | Pattern |
|------|----------|---------|
| Slot Unit | `spec/slots/*.test.ts` | Co-located |
| Component | `app/**/*.test.tsx` | Co-located |
| E2E | `tests/e2e/*.spec.ts` | Centralized |
