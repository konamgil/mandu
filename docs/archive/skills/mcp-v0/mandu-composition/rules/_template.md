# Rule Template

Use this template when creating new rules for mandu-composition.

---

```markdown
---
title: Rule Title Here
impact: HIGH | MEDIUM | LOW
impactDescription: 영향 설명 (예: "enables flexible composition")
tags: composition, tag1, tag2
---

## Rule Title Here

**Impact: {LEVEL} ({impactDescription})**

규칙의 목적과 아키텍처적 영향을 설명합니다.

**Incorrect (문제가 되는 패턴):**

\`\`\`tsx
// ❌ Boolean props로 기능 추가
function Composer({
  showAttachments,
  showFormatting,
  showEmojis,
  isCompact,
  isReadOnly,
}: Props) {
  return (
    <form>
      {!isReadOnly && <Input />}
      {showAttachments && <Attachments />}
      {showFormatting && <Formatting />}
      {showEmojis && <Emojis />}
    </form>
  );
}
```

**Correct (컴포지션 패턴):**

\`\`\`tsx
// ✅ 컴포지션으로 유연하게 구성
<Composer.Provider state={state} actions={actions}>
  <Composer.Frame>
    <Composer.Input />
    <Composer.Footer>
      <Composer.Emojis />
      <Composer.Submit />
    </Composer.Footer>
  </Composer.Frame>
</Composer.Provider>
\`\`\`

## Mandu Context

Mandu Island에서 이 패턴을 적용하는 방법을 설명합니다.

Reference: [관련 문서 링크](https://example.com)
```

---

## Naming Convention

- 파일명: `comp-{category}-{rule-name}.md`
- 예시: `comp-arch-compound-components.md`, `comp-state-context-interface.md`

## Core Principle

**Lift state, compose internals, make state dependency-injectable.**

UI는 조합 가능한 조각들이고, 상태는 Provider가 주입합니다.
Provider를 바꾸면 UI는 그대로 유지됩니다.
