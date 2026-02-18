# 07) Code Review and Standards

## Review checklist

- [ ] No unsafe `any` in changed core logic
- [ ] Assertions (`as`) minimized and justified
- [ ] Imports sorted; type-only imports used
- [ ] Return types and public API types are clear
- [ ] Union handling is exhaustive
- [ ] Nullability handled intentionally
- [ ] Error paths typed and explicit
- [ ] Mutable shared state avoided or isolated
- [ ] Tests cover behavior and type contract

## Style heuristics

- Prefer simple, obvious code over clever abstractions.
- Prefer early returns over deep nesting.
- Prefer functions over static-only classes.
- Keep one responsibility per module.
- Keep names explicit and domain-oriented.

## Forbidden unless justified

- Throwing non-Error values
- Silent `catch` blocks
- Hidden implicit `any`
- Broad `eslint-disable` across files
