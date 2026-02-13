# Realtime Chat Demo Validation Loop (Demo-First)

Mandu framework changes should be validated through the realtime chat demo first, then promoted into framework fixes/features.

## Why this loop exists

- Prevent speculative framework changes without user-facing evidence
- Keep architecture integrity (reuse-first, no duplication, guard compatibility)
- Make framework growth traceable from concrete demo scenarios

## Loop steps

1. **Reproduce or add demo scenario first**
   - Use `mandu-chat-demo` as the primary proving ground
   - Capture exact command, request path, and observed result

2. **Extract framework requirement**
   - Identify what is missing in core/cli/template
   - Label as: bug, safety gap, DX gap, architecture mismatch

3. **Philosophy alignment check**
   - Integrity: does this preserve config/runtime invariants?
   - Architecture: does it keep boundaries clean?
   - Reuse-first: can existing utilities be used?
   - Duplication-zero: does it remove or avoid repeated logic?

4. **Implement smallest framework change**
   - Minimal diff first
   - Include regression test when possible

5. **Round-trip verification**
   - Re-link/use latest package in demo
   - Run `lock`, `dev`, `check`, and critical API scenario

6. **Promote with evidence**
   - Issue/PR must include:
     - Demo reproduction logs
     - Philosophy alignment notes
     - Post-fix demo verification logs

## Recommended verification checklist

- [ ] `bunx @mandujs/cli lock`
- [ ] `bunx @mandujs/cli check`
- [ ] Demo dev boot succeeds
- [ ] `/api/health` and one chat API succeed
- [ ] No new architecture violations
- [ ] No new duplicate logic introduced

## PR template snippet (recommended)

```md
## Demo-first evidence
- Scenario:
- Repro command:
- Before:
- After:

## Mandu philosophy alignment
- Integrity:
- Architecture:
- Reuse-first:
- Duplication-zero:
```

## Notes

- If a change cannot be justified by a demo scenario, defer it.
- Prefer incremental PRs over large mixed-purpose refactors.
