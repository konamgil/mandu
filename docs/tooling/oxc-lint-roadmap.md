---
title: "Oxc 툴체인 도입 & Mandu 린트 탈바꿈 로드맵"
status: in-progress
audience: Mandu core team + contributors
created: 2026-04-23
related_commits:
  - 5d9598d  # infra — oxlint + oxlint-tsgolint install + .oxlintrc.json + scripts
  - 965e0a5  # first safe autofix — consistent-type-imports (16 files)
parent_context:
  - TypeScript 7 beta (tsgo) 도입 (854f304, 일전 commit)
  - "@typescript-eslint 대체 검토 결과"
---

# Oxc 툴체인 도입 & Mandu 린트 탈바꿈

> **TL;DR** — ESLint + @typescript-eslint 를 oxc 프로젝트 (`oxlint` + `oxlint-tsgolint`)
> 로 전환. 전체 품질 게이트 (lint + type-aware lint + typecheck) 를 ESLint 기반
> 동급 스택의 60–120초 → **~10초** 로 축소. 2026-04-23 까지 **인프라 + 1차 안전
> autofix** 완료. 남은 품질 이슈는 follow-up 으로 단계적 처리.

## 1. 왜 oxc 인가

### 1.1 이전 상태
- Mandu 레포는 ESLint 를 공식 채택하지 않음 — 개별 개발자가 에디터에서만 돌림.
- 새 프로젝트 템플릿은 "ESLint 추천" 문구만 있고 설치되지 않음.
- Guard 는 아키텍처/import 규칙만 담당 (빠름, ~1초) — type-aware 가 빠져 있음.

### 1.2 도입 이유 (우선순위)
1. **Type-aware 룰을 Mandu 속도로** — 이전엔 "너무 느려서 Guard 편입 불가" 라고 결론 냈던 규칙들 (`no-floating-promises`, `no-misused-promises`, `strict-boolean-expressions`, `no-explicit-any`) 을 실시간 피드백 가능한 속도로 돌릴 수 있게 됨.
2. **ESLint 대체** — Rust 기반 oxlint 가 ESLint 의 500+ 룰 포트 완료, 50–100× 빠름.
3. **TypeScript 7 생태계와 정렬** — `oxlint-tsgolint` 가 `typescript-go` 엔진 직접 사용. TS 7 GA 시 자동 혜택.

### 1.3 의사결정 근거
- **oxc 본체**: 20.8k stars, 231 releases, VoidZero (Evan You) 운영, Shopify/ByteDance/Preact 프로덕션.
- **tsgolint**: "Stable architecture, experimental↔GA 사이". TS 7 GA 와 같은 타임라인.
- 속도 벤치: typescript-eslint 대비 20–40× (microsoft/vscode 168s → 5s).

## 2. 설치 내역

### 2.1 devDependencies
```json
{
  "oxlint": "^1.61.0",
  "oxlint-tsgolint": "^0.21.1"
}
```

**안 깐 것** (의도적 — 중복/ROI 낮음):
- oxfmt (Prettier 생태계 압도적)
- oxc transformer / minifier (Bun 이 이미 대응)
- oxc resolver (Mandu 경로 해석 안정)

### 2.2 설정 파일 — `.oxlintrc.json`
보수적 출발점:
```json
{
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "pedantic": "off",
    "style": "off",
    "perf": "off",
    "restriction": "off",
    "nursery": "off"
  },
  "rules": {
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-imports": "warn",
    "typescript/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "no-debugger": "error",

    "no-console": "off",
    "no-await-in-loop": "off",
    "consistent-function-scoping": "off",
    "no-useless-escape": "off",
    "unicorn/no-array-sort": "off",
    "unicorn/prefer-spread": "off",
    "unicorn/no-useless-fallback-in-spread": "off",
    "no-shadow": "off"
  },
  "ignorePatterns": [
    "DNA/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/.mandu/**",
    "**/generated/**",
    "packages/cli/templates/**",
    "packages/cli/generated/**"
  ],
  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/tests/**"],
      "rules": {
        "typescript/no-explicit-any": "off",
        "typescript/no-unused-vars": "off"
      }
    }
  ]
}
```

**비활성 룰 이유**:
| 룰 | 이유 |
|---|---|
| `unicorn/no-array-sort` | `.sort()` → `.toSorted()` 자동 변환이 Mandu `target: ES2022` 와 불일치 (`toSorted` 는 ES2023). target 올릴 때 재활성. |
| `unicorn/prefer-spread` / `no-useless-fallback-in-spread` | false-positive 다수. |
| `no-await-in-loop` | 대부분 의도적 직렬화 (rate limit, transaction chain). 노이즈만. |
| `consistent-function-scoping` | 스타일 계열, 핵심 이슈 아님. |
| `no-console` | Mandu CLI 자체가 stdout 으로 사용자에게 출력. |
| `no-shadow` | TS 의 타입 컨텍스트에선 흔한 패턴. |

### 2.3 package.json scripts
```json
{
  "lint": "oxlint packages/",
  "lint:type-aware": "oxlint --type-aware packages/",
  "lint:fix": "oxlint --fix packages/"
}
```

**주의 — `lint:fix` 사용 가이드**:
- `oxlint --fix` 는 **활성 룰 전체** 에 대해 autofix 실행. target-lib 와 호환되지 않는 룰 (예: `no-array-sort`) 이 활성화돼 있으면 typecheck 회귀 가능.
- 안전한 사용: 임시 config (`.oxlintrc.fix-<rule>.json`) 를 만들어 **단일 룰만** 활성화 후 `--config` 로 전달.
- 예: `bun x oxlint --config .oxlintrc.fix-type-imports.json --fix packages/`

## 3. 벤치마크

Mandu 모노레포 (1140 파일, 7 패키지) 기준:

| 단계 | 도구 | 시간 |
|---|---|---|
| Lint (structural) | `oxlint` | **~500ms** |
| Lint (type-aware) | `oxlint --type-aware` | **~2.5s** (core 495 파일) |
| Typecheck | `tsgo` 병렬 checkers | **~7.6s** |
| **전체 품질 게이트 (합산)** | | **~10s** |

비교: ESLint + `@typescript-eslint` 기반 동급 스택 = 60–120초 (파일 500 기준 추정).

## 4. 현재 베이스라인 이슈

**2026-04-23 기준, 인프라 + 1차 autofix 완료 직후**:

- **75 error** — CI fail 유발 (category `correctness`)
- **372 warning** — 경고만, CI 통과

### 4.1 Error 주요 분포

| 룰 | 건수 | 성격 |
|---|---|---|
| `preserve-caught-error` | 45 | `catch (e) { throw new X() }` 에서 `{ cause: e }` 누락 |
| `typescript/no-explicit-any` | 39 (28 src + 11 tests) | 명시적 `any` — 테스트 파일 제외한 것만 실제 이슈 |
| 기타 correctness | ~10 | 케이스별 |

### 4.2 Warning 주요 분포

| 룰 | 건수 |
|---|---|
| `typescript/no-unused-vars` | 233 |
| `typescript/consistent-type-imports` | 51 (나머지는 1차 fix 로 해결) |
| `preserve-caught-error` | 기타 warn 수준 |
| 나머지 | <50 |

## 5. 지금까지 한 작업

### 5.1 완료

| Commit | 내용 | 안전성 |
|---|---|---|
| `5d9598d` | infra (oxlint + oxlint-tsgolint 설치 + .oxlintrc.json + scripts) | ✅ 소스 0 변경 |
| `965e0a5` | 1차 autofix — `consistent-type-imports` 단일 룰만 | ✅ 16 파일, 2-3줄 diff, typecheck+tests green |

### 5.2 진행 중
이 문서 (`docs/tooling/oxc-lint-roadmap.md`) 작성.

## 6. 주의 사항 & 실수에서 배운 것

### 6.1 "무차별 --fix" 사고
최초 `oxlint --fix packages/` 를 보수적 config 로 돌렸을 때 **162 파일 수정** 됨. 여러 룰이 동시에 autofix 되며 typecheck 회귀 발생 (`toSorted` / `import type` 리팩터 충돌 등).

**교훈**: `--fix` 는 **룰 한 개씩** 격리해서 돌릴 것. 임시 config 패턴 확립.

### 6.2 Target-lib 감안 안 되는 룰
`unicorn/no-array-sort` 가 `.toSorted()` (ES2023) 로 변환. Mandu target=ES2022 lib 에서 type error. target 과 lint 룰 간 호환성 사전 감사 필요.

### 6.3 Config 우선순위 주의
`categories` 설정 → 개별 `rules` 설정 순으로 오버라이드. 카테고리 "off" 여도 `rules` 에서 다시 켤 수 있음 (의도한 동작).

## 7. 탈바꿈 로드맵 (follow-up)

### A. `no-explicit-any` 39건 수동/반자동 수정
- **대상**: 소스 28건 (테스트 11건 제외)
- **방식**: 파일별 검토 — agent 분산 또는 수동. 적절한 타입 지정, `unknown` 전환, generic 도입.
- **스코프**: 2시간
- **Commit 전략**: 카테고리별 묶기 (e.g. "brain: any -> typed adapter signatures", "runtime: any -> concrete request shapes")

### B. `preserve-caught-error` 45건 autofix
- **대상**: `catch (e) { throw new X(...) }` → `throw new X(..., { cause: e })`
- **방식**: 단일 룰 임시 config + `--fix` + 수동 검토
- **스코프**: 30분
- **리스크**: Error 생성자가 `cause` 옵션 수용하는지 사전 확인. Mandu 에러 클래스 (`@mandujs/core/errors`) 감사 필요.

### C. pre-push 훅 편입
- **대상**: `lefthook.yml`
- **변경**: `bun run typecheck` 옆에 `bun run lint` 추가 (순차, 둘 다 10초대니까 총 20초 내)
- **스코프**: 15분

### D. 사용자 프로젝트 템플릿 반영
- **대상**: `packages/cli/templates/{default,auth-starter,realtime-chat}/`
- **변경**:
  - `package.json` devDeps: `oxlint` + `oxlint-tsgolint` 추가
  - `.oxlintrc.json` 템플릿 복사 (보수적 기본값)
  - `package.json` scripts: `lint` / `lint:type-aware` 추가
  - README/docs: "Mandu 공식 린트는 oxlint" 문구
- **스코프**: 30분

### E. Guard 에 `mandu guard --type-aware` 옵션
- **대상**: `packages/core/src/guard/` + `packages/cli/src/commands/guard-check.ts`
- **변경**:
  - `@mandujs/core/guard/tsgolint-bridge` 신규 서브모듈
  - oxlint `--type-aware` 호출 결과를 Guard `Violation` 포맷으로 변환
  - `mandu.config.ts` 의 `guard.typeAware: { rules, severity }` 필드 추가
  - pretty / JSON 출력 모두 type-aware 결과 포함
- **스코프**: 1-2일
- **TS 7 GA 와 맞추는 게 이상적** (2개월 내)

### F. 사용자 마이그레이션 가이드
- **대상**: `docs/tooling/eslint-to-oxlint.md` (신규)
- **내용**:
  - 기존 ESLint 설정 → oxlint 매핑 테이블
  - 지원 안 되는 룰 (59/61) 대체법
  - ESLint 병행 필요한 경우 (e.g. eslint-plugin-jest)
  - FAQ: fix 안 되는 이슈, 에디터 확장 (oxc VS Code extension)
- **스코프**: 1-2시간
- **타이밍**: D 후

## 8. 성공 지표

- [x] Mandu 레포 전체 lint 완료 < 1초
- [x] Mandu 레포 type-aware lint < 3초
- [x] typecheck (tsgo) < 10초
- [ ] Error 0 달성 (현재 75)
- [ ] pre-push 훅에서 lint + typecheck 20초 내 전원 통과
- [ ] 사용자 템플릿에서 `bun run lint` 기본 제공
- [ ] Guard 에 type-aware 레이어 통합

## 9. 관련 문서 / 레퍼런스

- [oxc 프로젝트](https://github.com/oxc-project/oxc)
- [oxlint-tsgolint](https://github.com/oxc-project/tsgolint)
- [oxlint 설정 스키마](https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json)
- [TypeScript 7 beta 발표](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/)
- Mandu 관련:
  - `scripts/typecheck.ts` — tsgo default + `--checkers` 병렬
  - `.oxlintrc.json` — 현재 린트 설정
  - `docs/ate/roadmap-v2-agent-native.md` — ATE 와 Guard 의 "context provider" 철학 (같은 방향)
