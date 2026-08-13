---
name: mandu-lint
description: |
  Lint 가이드 — 가드레일의 한 축. oxlint 셋업 / 실행 / type-aware /
  lefthook 통합. "lint 켜줘", "코드 스타일 검사", lint 에러 발생 시 자동 호출.
---

# Mandu Lint

Mandu 의 lint 레이어는 **guard (아키텍처) + typecheck (타입) + lint (코드 품질)**
3축 가드레일 중 하나. oxlint (Rust-based, ESLint 대비 50–100× 빠름) 를 기본으로.

## 가드레일 체계 (꼭 기억할 것)

| 레이어 | 도구 | 무엇을 잡나 | 비용 |
|--------|------|-----------|------|
| **guard** | `mandu guard` / `mandu_guard_check` | 아키텍처 / 레이어 / import 규칙 | ~1s |
| **typecheck** | `mandu check` / `tsgo` | 타입 에러 | ~7s |
| **lint** | `oxlint` / `mandu.lint` | 코드 품질 (`no-explicit-any`, `no-unused-vars`, 등) | ~500ms |
| **lint --type-aware** | `oxlint --type-aware` / `mandu guard --type-aware` | 타입 의존 lint (`no-floating-promises`) | ~3s |

세 개 모두 녹색이 된 후에만 commit / push. `mandu check` 는 이 모두를 종합 실행.

## Trigger

- 파일 편집 후 (특히 대량 수정 / 리팩터)
- "lint 해줘", "코드 스타일 체크", "warning 줄여줘"
- lint 에러가 CI 에서 발견된 경우
- 신규 프로젝트 셋업 / 기존 프로젝트에 lint 미설치 상태

## MCP 도구

| 도구 | 용도 | side effect |
|------|------|------------|
| `mandu.lint` | 린트 실행 + 에러/경고 카운트 | 없음 (읽기 전용) |
| `mandu.lint.setup` | oxlint 설치 + `.oxlintrc.json` 스캐폴드 + scripts 배선 | 파일 수정 (destructive) |

## 표준 흐름

### 1. 신규 프로젝트
`mandu init` 은 `.oxlintrc.json` + `oxlint` devDep + `lint` 스크립트 + `lefthook.yml` (pre-push lint + typecheck) 를 기본 포함. 추가 작업 불필요.

### 2. 기존 프로젝트에 lint 가 없는 경우
```
mandu.lint.setup({ dryRun: true })   ← 먼저 계획 보기
  → mandu.lint.setup({})              ← 적용
  → mandu.lint({})                    ← 베이스라인 확인
```

또는 shell:
```bash
mandu lint --setup
mandu lint
```

### 3. 편집 후 검증
`mandu-mcp-verify` fast path 에 이미 포함됨:
```
mandu.ate.auto_pipeline   ← parallel
mandu.guard.check         ← parallel
mandu.lint                ← parallel (신규)
mandu.doctor              ← parallel
```

### 4. 자동 수정
**절대 `oxlint --fix .` 를 무차별 실행하지 말 것.** 과거에 `.toSorted()` 변환으로 ES 타겟이 깨진 전례 있음 (`docs/tooling/oxc-lint-roadmap.md` §"1차 --fix 대참사").

안전한 자동 수정 절차:
1. 한 룰만 활성화한 임시 config 작성:
   ```bash
   cat > .oxlintrc.fix-type-imports.json <<'EOF'
   {
     "categories": { "correctness": "off" },
     "rules": { "typescript/consistent-type-imports": "warn" }
   }
   EOF
   ```
2. 해당 룰만 --fix:
   ```bash
   oxlint --config .oxlintrc.fix-type-imports.json --fix .
   ```
3. 즉시 typecheck + 테스트 검증
4. 커밋
5. 임시 config 삭제

### 5. Type-aware (선택)
```bash
bun add -D oxlint-tsgolint
bun x oxlint --type-aware .
# 또는
mandu guard --type-aware
```

Type-aware 룰이 잡는 것:
- `typescript/no-floating-promises` — await 누락
- `typescript/no-misused-promises` — Promise 를 boolean 자리에
- `typescript/strict-boolean-expressions` — nullish 체크 누락
- `typescript/preserve-caught-error` — `throw new Error("...", { cause })` 누락

## 표준 `.oxlintrc.json` (Mandu 템플릿 기준)

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
    "no-debugger": "error"
  },
  "ignorePatterns": ["**/node_modules/**", "**/dist/**", "**/.mandu/**", "**/generated/**"],
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

## CI 통합

Mandu 신규 프로젝트는 `lefthook.yml` 포함:
```yaml
pre-push:
  parallel: true
  commands:
    typecheck:
      run: bun run check
    lint:
      run: bun run lint
```

`prepare: "lefthook install"` 스크립트가 `bun install` 시 자동으로 hook 을 걸음.

## `mandu build` 게이트

프로덕션 빌드 전 lint **에러** 는 자동으로 빌드를 막음 (warning 은 통과).
긴급 배포 시 `--no-lint` 로 우회:

```bash
mandu build              # lint error 있으면 block
mandu build --no-lint    # lint 건너뛰기
```

## 절대 규칙

| # | 규칙 | 이유 |
|---|------|------|
| L-1 | `oxlint --fix .` 전역 실행 금지 | 과거 ES 타겟 깨짐. 룰별 selective fix 패턴 사용 |
| L-2 | lint 에러를 `.oxlintrc.json` 의 `off` 로 돌려 회피 금지 | 실제 버그 놓침. site-level `// oxlint-disable-next-line <rule>` 또는 실제 수정 |
| L-3 | `mandu.lint.setup` 은 기존 `lint` script 를 덮어쓰지 않음 | ESLint 사용자 프로젝트 보호 |
| L-4 | 편집 후 `mandu-mcp-verify` 없이 commit 금지 | lint 는 verify 의 한 축 |

## Anti-patterns

### AP-1 — oxlint 룰을 모두 `off` 로 돌리기
- 증상: 에러가 뜨면 `.oxlintrc.json` 에 `"rule-name": "off"` 추가
- 왜 안 되나: 의도적 패턴이면 site-level disable 이 맞고, 실수라면 고쳐야 함. 전역 off 는 같은 실수를 또 만들 여지를 남김
- 대응: (a) 정말 의도적이면 해당 사이트에 `// oxlint-disable-next-line <rule>` + 이유 주석, (b) 실수면 실제 수정

### AP-2 — lint 를 CI 에서만 돌리기
- 증상: 로컬 에서 안 돌리고 CI 에서 처음 실패 발견
- 왜 안 되나: 왕복 5–10분. 에디터 plugin + pre-push hook 으로 로컬에서 5초 안에 확인 가능
- 대응: `oxlint-vscode` 설치 + `lefthook install` (템플릿이 이미 제공)

### AP-3 — `oxlint` 와 `eslint` 동시 실행
- 증상: 기존 ESLint 설정을 남긴 채 oxlint 추가
- 왜 안 되나: 룰 중복 → warning 2배 → 개발자 번아웃
- 대응: `mandu-lint` 채택 시 `.eslintrc.*` + ESLint 관련 deps 전부 제거 (`docs/tooling/eslint-to-oxlint.md` 참고)

## Quick Reference

```
lint 가드레일 하루 주기:
  편집 ─→ 에디터 oxlint plugin 이 즉시 표시
       ─→ mandu-mcp-verify (lint + guard + ate + doctor 병렬)
       ─→ pre-push (lefthook) lint + typecheck
       ─→ CI lint + typecheck + guard
       ─→ mandu build 의 자동 lint 게이트
```

## See Also

- `mandu-guard-guide` — 아키텍처 가드레일 (lint 와 상호보완)
- `mandu-mcp-verify` — verify fast path 에 lint 포함
- `mandu-mcp-safe-change` — 대규모 refactor 의 verify 단계에 lint
- `docs/tooling/oxc-lint-roadmap.md` — 내부 도입 로드맵
- `docs/tooling/eslint-to-oxlint.md` — ESLint → oxlint 마이그레이션 가이드
