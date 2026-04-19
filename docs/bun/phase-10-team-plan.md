---
title: "Phase 10 — mandujs.com 마이그레이션 + 공식 docs 사이트"
status: execution-plan
created: 2026-04-19
depends_on:
  - docs/bun/phase-10-diagnostics/mandujs-com-inventory.md
  - docs/bun/phase-10-diagnostics/breaking-changes.md
  - docs/bun/phase-10-diagnostics/docs-ia.md
---

# Phase 10 — mandujs.com 자산화

**목표**: 기존 `mandujs.com` 랜딩을 **Mandu 0.22+ / CLI 0.23+** 최신으로 마이그레이션 + **공식 docs 사이트** 구축. Self-hosting 증명 (Mandu 로 만든 Mandu 문서).

## 0. R0 진단 요약

| 진단 | 결정적 결과 |
|---|---|
| Inventory | 성숙한 FSD+Clean 구조 · i18n 23 언어 · Stitch design 완전 정의 · E2E 5 spec. 재활용 가치 매우 높음 |
| Breaking changes | **공식 breaking 단 2건** (Bun ≥ 1.3.12 + tsconfig types). 나머지 Phase 0~9 전부 additive. 마이그레이션 ~20분 |
| Docs IA | 상단 6 네비 / 사이드바 9 그룹 / Mandu 고유 개념 15개 / Starlight + MDX + Shiki + Pagefind |

---

## 1. 실제 scope (R0 반영)

| 작업 | 시간 |
|---|---|
| **Pre-R1 마이그레이션** (내가 직접) — deps bump + tsconfig + CI + `.mandu/client` clean | ~30분 |
| **R1.A Docs 10 핵심 페이지 scaffold** (frontend-architect) | 1주 |
| **R1.B Landing 카피 업데이트 + Download 페이지** (frontend-architect) | 3~5일 |
| R2 Docs 확장 + i18n ko+en full | 1~2주 |
| R3 Blog + Phase 4c~9 쇼케이스 + 배포 QA | 1주 |

---

## 2. Pre-R1 — 내가 직접 수행 (마이그레이션)

9 단계 checklist:
1. `@mandujs/core` `^0.20.8` → `^0.22.0`
2. `@mandujs/cli` `^0.21.6` → `^0.23.0`
3. `@mandujs/mcp` `^0.19.3` → `^0.20.0`
4. `engines.bun` `>=1.0.0` → `>=1.3.12`
5. `packageManager` `bun@1.2.0` → `bun@1.3.12`
6. `tsconfig.types` `["bun-types"]` → `["bun"]` + `bun add -d @types/bun`
7. `.github/workflows/*.yml` `oven-sh/setup-bun@v2` 에 `bun-version: "1.3.12"` 명시
8. `package-lock.json` 제거 (bun-only 정책)
9. `.mandu/` clean + `bun install` + `bun run build` + E2E smoke

---

## 3. R1.A — Docs 사이트 10 핵심 페이지

**파일 범위**:
- `mandujs.com/app/[lang]/docs/` 서브트리 신규
- `mandujs.com/src/client/widgets/docs-nav/` 사이드바 컴포넌트
- `mandujs.com/src/client/widgets/search/` Pagefind 통합
- `mandujs.com/content/docs/` MDX 페이지들

**10 핵심 페이지** (R0.3 IA 기반):
1. `/docs` — 랜딩 (What is Mandu?)
2. `/docs/installation` — npm + binary + CLI
3. `/docs/quick-start` — 5분
4. `/docs/project-structure`
5. `/docs/concepts/filling`
6. `/docs/concepts/slot`
7. `/docs/concepts/contract`
8. `/docs/concepts/island`
9. `/docs/concepts/resource` (Phase 4c)
10. `/docs/concepts/guard`

**i18n**: 한국어 (ko) full + 영어 (en) full. 나머지 21 언어는 랜딩만 유지.

**툴체인**:
- Markdown/MDX → Shiki syntax highlight
- Pagefind 검색
- 기존 Stitch design system 재활용
- `Bun.markdown.ansi` 는 CLI 전용이라 서버 렌더에는 안 쓰고 MDX 컴파일러 직접 사용

---

## 4. R1.B — Landing 업데이트 + Download 페이지

**파일 범위**:
- `mandujs.com/app/[lang]/page.tsx` — 기존 532 줄 landing 에 Phase 4c~9 섹션 추가
- `mandujs.com/app/[lang]/download/` 신규 — 바이너리 다운로드 + install.sh/ps1 안내
- `mandujs.com/src/shared/utils/client/i18n/translations/` ko/en 번역 확장

**Landing 새 섹션** (기존 Problem / Features / Comparison 확장):
- "Self-hosted"  — Bun 단일 바이너리 + webview 데스크톱 + HMR 22.5ms P95 뽐내기
- "Full Stack Primitives" — DB resource / OAuth / Email / rate-limit 가 **내장**
- "Developer Experience" — Fast Refresh + Kitchen DevTools + ATE

---

## 5. 파일 충돌 관리

- Pre-R1 (내가): `package.json` / `bun.lock` / `tsconfig.json` / `.github/workflows/`
- R1.A (docs): `app/[lang]/docs/` (전부 신규) + `src/client/widgets/docs-*` + `content/docs/`
- R1.B (landing+download): `app/[lang]/page.tsx` (기존 수정) + `app/[lang]/download/` (신규) + `translations/ko.ts`, `en.ts` (확장)

A+B 영역 겹침 없음. Pre-R1 완료 후 A+B 병렬.

---

## 6. 품질 게이트

1. 마이그레이션 후 기존 E2E 5 spec pass
2. R1 후 신규 11+ 페이지 Playwright smoke
3. `bun run check` + `bun run guard` 통과
4. `Bun.build` deploy 가능한 artifacts 생성
5. 한국어 + 영어 spellcheck (optional)
6. Lighthouse score ≥ 90 (performance / accessibility)

---

## 7. 커밋 전략 (mandujs.com 레포)

- `chore(deps): Phase 10 — upgrade to Mandu core 0.22 + cli 0.23 + Bun 1.3.12`
- `feat(docs): Phase 10.R1.A — 10 core pages + sidebar + Pagefind search`
- `feat(landing,download): Phase 10.R1.B — Phase 4c~9 showcase + binary download`
- `feat(docs): Phase 10.R2 — 20 extended pages + i18n ko+en full`
- `feat(docs,blog): Phase 10.R3 — blog + deployment QA`

---

## 8. 예상 시간

- Pre-R1 (me): ~30분
- R1 병렬 2: 1주 (A) · 3~5일 (B) — 독립 스케줄
- R2 확장: 1~2주
- R3 마무리: 1주

**전체 wall clock**: 2~3주 (에이전트 기반 압축 시 절반 가능)
