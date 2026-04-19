---
title: "Phase 11 — 완성도 스프린트 (9.1 follow-up + 7.4)"
status: execution-plan
created: 2026-04-19
depends_on:
  - docs/bun/phase-11-diagnostics/completeness-sprint.md
  - docs/security/phase-9-audit.md
  - docs/bun/phase-7-2-benchmarks.md
---

# Phase 11 — 완성도 스프린트

**목표**: Phase 9 감사 8건 + Phase 7.3 성능 2건 묶어서 **2.5일** 완료. 3 sub-agent 병렬.

## 1. Wave A 일환 (Phase 15 와 동시 실행)

## 2. 에이전트 구성 (3 병렬)

### Agent A — 공급망/DevOps (backend-architect)

**파일 범위**:
- `.github/workflows/release-binaries.yml` · `ate-e2e.yml` · `ate-e2e-subset.yml` — Actions SHA pin (I-01)
- 신규 `.github/workflows/slsa-provenance.yml` — `actions/attest-build-provenance@v2`
- `packages/cli/scripts/generate-template-manifest.ts` — `packages/skills/SKILL.md` 임베딩 (I-03)
- 신규 `packages/cli/templates/skills/` — 임베딩 대상 files
- `packages/cli/src/util/templates.ts` — skills 로드 API
- (외부 대기 트랙) `docs/code-signing.md` — Windows EV + Apple Dev ID 수속 가이드

**Output**: GitHub Releases 시 SLSA provenance 자동 생성 + action 공급망 고정 + mandu.exe init 시 SKILL.md 9 warnings 해소

### Agent B — Security/Installer (security-engineer)

**파일 범위**:
- `packages/cli/src/cli-ux/markdown.ts` — control-char / OSC 8 allowlist sanitizer (L-04)
- `packages/cli/src/commands/desktop.ts` — `--entry=<abs>` containment check (L-03)
- `install.sh` · `install.ps1` · `install.bash` — `MANDU_REPO` warning + `MANDU_INSTALL_DIR` char filter (L-01 + L-02)
- 신규 `packages/cli/src/cli-ux/__tests__/markdown-sanitizer.test.ts`
- 신규 `packages/cli/src/commands/__tests__/desktop-entry-path.test.ts`
- 신규 `.github/workflows/__tests__/installer-env-injection.sh`

**Output**: 4 Low 보안 전부 close · 회귀 테스트 3종

### Agent C — Performance/Compat (backend-architect)

**파일 범위**:
- `packages/cli/src/util/jit-prewarm.ts` — deep-import 확장 (registerManifestHandlers + bundledImport 내부 경로) (7.4)
- `scripts/cli-bench.ts` — Bun 1.3.13+ cold recheck 지점
- `packages/core/src/desktop/window.ts` — webview-bun optional + 상류 webview/webview FFI fallback prototype (M-02)
- 신규 `packages/core/src/desktop/webview-fallback.ts` — FFI 직접 바인딩
- 신규 `packages/cli/src/util/__tests__/jit-prewarm-deep.test.ts`
- 신규 `packages/core/src/desktop/__tests__/webview-fallback.test.ts`

**Output**: first-iter 25ms → ≤ 15ms · FFI fallback 으로 single-maintainer 공급망 리스크 완화

## 3. 파일 충돌 매트릭스

| 파일 | A | B | C |
|---|---|---|---|
| `.github/workflows/*` | 전부 | smoke 추가 | - |
| `packages/cli/src/cli-ux/` | - | markdown.ts | - |
| `packages/cli/src/commands/desktop.ts` | - | 엔트리 validation | - |
| `packages/cli/src/util/jit-prewarm.ts` | - | - | 전부 |
| `packages/core/src/desktop/` | - | - | window.ts + fallback |
| `install.*` | - | 전부 | - |
| `packages/cli/scripts/generate-template-manifest.ts` | skills 추가 | - | - |

**충돌**: 없음. 3 에이전트 완전 독립.

## 4. 실행 순서 (2.5일)

- **Day 1 Critical 병렬**:
  - A: SLSA + Actions SHA pin
  - B: markdown sanitizer + desktop containment
  - C: JIT deep-import prewarm
- **Day 2 중요 병렬**:
  - A: skills manifest 임베딩
  - B: installer char filter
  - C: Bun recheck + FFI fallback prototype
- **Day 3 통합 + 검증 + 커밋**

## 5. 품질 게이트

1. `bun run typecheck` 4 packages clean (NODE_OPTIONS=--max-old-space-size=8192)
2. 기존 모든 audit 항목 (L-01~L-04, M-01, M-02, I-01) 의 regression 테스트 추가
3. `mandu.exe init` 에서 skills SKILL.md 9 warnings → 0 warnings
4. `cli-bench` 에서 first-iter ≤ 15ms
5. installer dry-run smoke 유지

## 6. 예상 커밋

- `feat(cli,ci): Phase 11.A — SLSA provenance + Actions SHA pin + skills embedding`
- `security(cli): Phase 11.B — markdown sanitizer + desktop entry containment + installer hardening`
- `perf(cli,core): Phase 11.C — JIT deep-import prewarm + webview-bun FFI fallback`
- `test: Phase 11 — regression suite (Low findings + JIT prewarm)`
- `chore: Phase 11 merge + bump versions`
