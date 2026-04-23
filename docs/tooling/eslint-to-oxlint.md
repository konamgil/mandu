---
title: "ESLint → oxlint 마이그레이션 가이드"
status: stable
audience: Mandu 사용자 + contributors (ESLint 프로젝트에서 오는 사람)
created: 2026-04-23
related_docs:
  - ./oxc-lint-roadmap.md   # Mandu 내부 도입 로드맵 (historical context)
---

# ESLint → oxlint 마이그레이션 가이드

> **목표** — ESLint + @typescript-eslint 로 구성된 프로젝트를 **oxlint**
> (+ 선택적 `oxlint-tsgolint`) 로 이전. 린트 pass 를 60–120 초에서
> **500ms ~ 3s** 로 축소. Mandu 내부 기준 60× 향상.

이 가이드는 Mandu 자체의 이전 경험 (commits `5d9598d`, `965e0a5`,
`f52ce17`) 을 바탕으로 씁니다. 당신 프로젝트의 ESLint 설정이 어떻든 90%
는 그대로 옮길 수 있지만, **자동-fix 전략** 에는 반드시 함정이 있으니
§5 를 먼저 읽으세요.

---

## 0. 전제

- **TypeScript 5.x 또는 7.x (tsgo)** — oxlint 자체는 ts 버전 무관.
  `--type-aware` (tsgolint) 는 아직 TS 5/6 기준 타입 체크로도 동작.
- **Bun, pnpm, npm, yarn** — 전부 지원. Mandu 는 Bun 기준.
- 기존 `.eslintrc.*` + ESLint plugin 들 (플러그인: typescript-eslint,
  import, unicorn, jsx-a11y, react, react-hooks) 이 있는 레포를 가정.

## 1. 왜 이전하나

| 항목              | ESLint + @ts-eslint     | oxlint + oxlint-tsgolint |
| ---------------- | ----------------------- | ------------------------ |
| 풀 lint (중형)    | 30–60s                  | 300–800ms (**50–100×**)  |
| Type-aware lint  | 60–120s                 | 2–3s (**20–40×**)        |
| 메모리            | 1–2 GB                  | <200 MB                  |
| Rule 커버리지     | 500+                    | ESLint 코어 ~450 + ts 59/61 |
| 플러그인 생태계   | 압도적 (custom 쉬움)    | 고정 세트 (custom 불가)   |
| 설정 언어        | JS/TS/YAML/JSON         | JSON only                |
| IDE              | 전부                    | VS Code, Zed, JetBrains  |

**언제 이전하면 안 되나**: custom ESLint 플러그인에 의존 중이면
당분간 보류. oxlint 는 dynamic plugin 을 지원하지 않습니다 (Rust 바이너리).

## 1.5 Mandu 기존 프로젝트 자동 설치

Mandu 프로젝트라면 아래 한 줄로 §2 / §3.1 과정을 전부 자동화:

```bash
mandu lint --setup
```

이게 해주는 것:

- `.oxlintrc.json` 없으면 Mandu 표준 템플릿으로 생성
- `package.json` 의 `scripts.lint` / `scripts.lint:fix` 없으면 추가 (있으면 보존)
- `devDependencies.oxlint` 없으면 `^1.61.0` 추가
- `bun install` 실행
- 초기 lint 패스로 현재 error/warning 베이스라인 출력

**Idempotent** — 두 번째 실행 시 전부 skip 되고 "nothing to do" 로 끝남.

**안전장치** — 이미 `scripts.lint` 가 ESLint 를 가리키고 있으면 덮어쓰지 않고 경고만 표시. 사용자가 수동으로 전환할 수 있게.

`--dry-run` 으로 미리보기 가능:

```bash
mandu lint --setup --dry-run
```

`mandu lint` (인자 없음) 은 그냥 `bun run lint` 를 대신 실행합니다.

## 2. 설치

### 2.1 의존성

```bash
bun add -D oxlint
# 선택 — type-aware 룰을 원하면:
bun add -D oxlint-tsgolint
```

`oxlint-tsgolint` 는 `@typescript/native-preview` (tsgo) 를 peer 로 요구.
TypeScript 7 beta 가 이미 깔려있으면 추가 설치 불필요.

### 2.2 스크립트

```json
{
  "scripts": {
    "lint": "oxlint .",
    "lint:type-aware": "oxlint --type-aware .",
    "lint:fix": "oxlint --fix ."
  }
}
```

### 2.3 기존 ESLint 제거

```bash
bun remove eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  eslint-plugin-import eslint-plugin-unicorn eslint-plugin-react eslint-plugin-react-hooks
rm .eslintrc.* .eslintignore
```

`package.json` 의 `"eslintConfig"` 블록이 있으면 제거.

## 3. 설정 이전

### 3.1 `.eslintrc.json` → `.oxlintrc.json`

ESLint 의 `extends` 는 oxlint 에서 **카테고리** 로 갈음합니다.
다음은 Mandu 가 쓰는 보수적 출발점:

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
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
    "typescript/no-unused-vars": [
      "warn",
      { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }
    ],
    "no-debugger": "error",
    "no-console": "off"
  },
  "ignorePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/generated/**"
  ],
  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
      "rules": {
        "typescript/no-explicit-any": "off",
        "typescript/no-unused-vars": "off"
      }
    }
  ]
}
```

**주의**: `no-unused-vars` 는 ESLint 코어 이름 그대로지만 TypeScript
파일에서는 `typescript/no-unused-vars` 를 활성화하고 코어는
`"no-unused-vars": "off"` 로 두세요 (중복 경고 방지).

### 3.2 카테고리 매핑 표

| ESLint `extends`                          | oxlint 카테고리                     |
| ----------------------------------------- | ----------------------------------- |
| `eslint:recommended`                      | `correctness: error`                |
| `plugin:@typescript-eslint/recommended`   | `correctness: error` + ts 룰        |
| `plugin:@typescript-eslint/strict`        | `correctness + suspicious`          |
| `plugin:import/recommended`               | `correctness` 의 `import/*` 룰 포함 |
| `plugin:unicorn/recommended`              | `correctness` 의 `unicorn/*` 포함   |
| 없음 (사용자가 룰 one-by-one 추가)       | `rules` 블록에 개별 지정            |

### 3.3 룰 이름 변경

플러그인 prefix 는 **slash 로 남깁니다** (colon 아님):

```json
// ESLint
"@typescript-eslint/no-explicit-any": "error"

// oxlint
"typescript/no-explicit-any": "error"
```

| ESLint prefix              | oxlint prefix  |
| -------------------------- | -------------- |
| `@typescript-eslint/`      | `typescript/`  |
| `import/`                  | `import/`      |
| `unicorn/`                 | `unicorn/`     |
| `react/`, `react-hooks/`   | `react/`       |
| `jsx-a11y/`                | `jsx-a11y/`    |
| `promise/`                 | `promise/`     |

### 3.4 Override 문법

ESLint `overrides` 와 거의 호환:

```json
"overrides": [
  { "files": ["**/*.test.ts"], "rules": { "typescript/no-explicit-any": "off" } }
]
```

차이점: oxlint 는 아직 `extends` inside override 를 지원하지 않음.
대신 `rules` 에 인라인.

## 4. 기존 ESLint 룰 이전

### 4.1 1:1 포팅 가능

아래는 Mandu 레포에서 실제로 이전한 룰. 거의 그대로 씀:

```
no-debugger                → no-debugger                 (코어, 동일)
eqeqeq                     → eqeqeq                      (동일)
no-var                     → no-var                      (동일)
prefer-const               → prefer-const                (동일)
@typescript-eslint/no-explicit-any
                           → typescript/no-explicit-any  (prefix 만 교체)
@typescript-eslint/consistent-type-imports
                           → typescript/consistent-type-imports
import/no-cycle            → import/no-cycle             (동일)
unicorn/no-null            → unicorn/no-null             (동일)
```

### 4.2 Type-aware 룰 (oxlint-tsgolint 필요)

```
@typescript-eslint/no-floating-promises
                           → typescript/no-floating-promises (type-aware 전용)
@typescript-eslint/no-misused-promises
                           → typescript/no-misused-promises
@typescript-eslint/strict-boolean-expressions
                           → typescript/strict-boolean-expressions
@typescript-eslint/preserve-caught-error
                           → typescript/preserve-caught-error
@typescript-eslint/no-unnecessary-type-assertion
                           → typescript/no-unnecessary-type-assertion
```

실행: `oxlint --type-aware .` (59/61 typescript-eslint type-aware 룰 지원).

### 4.3 아직 포트 안 된 룰

Mandu 가 확인한 미지원 룰 (2026-04 기준):
- `@typescript-eslint/prefer-readonly-parameter-types` — WIP
- `import/no-unresolved` — oxlint 는 module resolution 안 함 (oxc-resolver 별도)
- custom 팀 플러그인 — 일반적으로 지원 불가

이런 룰이 필요하면 **ESLint 를 같이 돌리되 해당 룰만 남기는**
점진 마이그레이션 전략을 권장.

## 5. Autofix 전략 (⚠️ 실전 함정)

### 5.1 절대로 하지 말 것: `oxlint --fix .`

Mandu 는 이걸 한 번에 돌려서 162 개 파일을 건드렸고 typecheck 가
깨졌습니다. 원인: `unicorn/no-array-sort` 가 `.sort()` → `.toSorted()`
로 바꾸는데 `.toSorted()` 는 ES2023. lib 타겟이 ES2022 이면 즉사.

### 5.2 대신: 선택적 autofix

1. **임시 설정 파일 작성**:
   ```bash
   cat > .oxlintrc.fix-type-imports.json <<'EOF'
   {
     "categories": { "correctness": "off", "suspicious": "off" },
     "rules": { "typescript/consistent-type-imports": "warn" }
   }
   EOF
   ```
2. **해당 룰만 fix 돌림**:
   ```bash
   oxlint --config .oxlintrc.fix-type-imports.json --fix .
   ```
3. **즉시 검증**: `bun run typecheck && bun test`.
4. **커밋 후 다음 룰로 진행**.
5. **임시 config 삭제**.

### 5.3 Autofix 순서 (Mandu 경험치)

| 룰                                    | 위험도 | 비고                            |
| ------------------------------------ | ------ | ------------------------------- |
| `typescript/consistent-type-imports` | 🟢 낮음 | `import type` 분리만           |
| `typescript/no-unused-vars`          | 🟡 중간 | side-effect import 는 보존    |
| `no-debugger`                        | 🟢 낮음 | 라인 삭제                      |
| `typescript/preserve-caught-error`   | 🟡 중간 | `{ cause }` 추가 — Error subclass 이 forward 하는지 확인 |
| `typescript/no-explicit-any`         | 🔴 높음 | **autofix 금지**. 수동 타입화  |
| `unicorn/no-array-sort`              | 🔴 높음 | ES2023 API 변환 — 비활성 권장 |

### 5.4 Warning 을 일단 수용

Mandu 는 372 warning 을 **수용 상태로 시작**했습니다. warning 을
error 로 승격하기 전 수동 수정 또는 선택-fix 를 끝내세요.

## 6. 에디터 통합

### 6.1 VS Code

[oxlint-vscode](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode) 설치.
설정:

```json
{
  "oxc.lint.run": "onType",
  "oxc.lint.configPath": "./.oxlintrc.json"
}
```

ESLint extension 은 제거하거나 `"eslint.enable": false`.

### 6.2 JetBrains

[oxlint plugin](https://plugins.jetbrains.com/plugin/24606-oxlint) —
2025 년 GA. 설정 `.oxlintrc.json` 자동 탐지.

### 6.3 Zed

내장. `languages.toml` 에 별도 설정 불필요.

### 6.4 Neovim / Vim

`nvim-lspconfig` 에서 `oxc_language_server` 활성. 또는
`conform.nvim` + `oxlint` formatter (fix-on-save).

## 7. CI 통합

### 7.1 GitHub Actions

```yaml
- name: Lint
  run: bun run lint
- name: Type-aware lint
  run: bun run lint:type-aware
```

병렬화 (Mandu 는 lefthook 으로 로컬 pre-push 도 병렬):

```yaml
# lefthook.yml
pre-push:
  parallel: true
  commands:
    typecheck: { run: bun run typecheck }
    lint: { run: bun run lint }
```

### 7.2 exit code

- **0** — 에러 없음 (warning 은 허용).
- **1** — 에러 또는 내부 실패.
- `--deny-warnings` 플래그로 warning 도 실패 처리 가능.

Mandu 는 당분간 warning 을 CI 실패로 취급하지 않습니다.

## 8. Mandu 고유 통합

### 8.1 `mandu guard --type-aware`

Mandu 프로젝트에서는 `mandu guard --type-aware` 한 방으로
아키텍처 lint + type-aware lint 를 함께 돌립니다. 내부적으로
`oxlint --type-aware` 를 호출.

### 8.2 `oxlint` + `mandu guard` 관계

| 툴             | 담당                                      | 속도    |
| ------------- | ---------------------------------------- | ------- |
| `mandu guard` | 아키텍처/import 레이어 (FSD, clean, CQRS) | ~1s     |
| `oxlint`      | 코드 품질 (ESLint 룰 포트)                | ~500ms  |
| `oxlint --type-aware` | 타입 의존 룰 (floating promise 등) | ~2–3s   |
| `bun run typecheck` (tsgo) | TS 컴파일 에러                | ~7s     |

네 개를 다 돌려도 **<15s**. ESLint 시절보다 빠름.

## 9. 트러블슈팅

### 9.1 "unknown rule"
ESLint 시절 썼던 룰 이름이 오타이거나 oxlint 미지원. 이름 변경
표(§3.3) 를 확인.

### 9.2 "unexpected token" parser 오류
oxlint 는 **최신 TC39 문법** 을 항상 지원합니다. 이 에러가 나오면
decorator / explicit resource management 같은 proposal 문법에서는
`--experimental` 플래그 확인. 보통은 `.oxlintrc.json` 의
`ignorePatterns` 에 해당 파일을 넣는 게 현실적.

### 9.3 "config not found" in monorepo
모노레포 패키지 루트마다 `.oxlintrc.json` 을 둘 필요 없음. oxlint
는 `--config` 명시 또는 가장 가까운 상위 config 를 자동 탐지.

### 9.4 타입-aware 가 `tsgo` 를 못 찾음
`@typescript/native-preview` 설치 여부 확인:
```bash
bun pm ls | grep native-preview
```
없으면 `bun add -D @typescript/native-preview`.

### 9.5 ESLint 플러그인 대체 불가
Custom 룰 → **TypeScript 컴파일 룰** 또는 **guard 규칙** 으로
치환 시도. 여전히 필요하면 ESLint 를 해당 파일에만 소수로 남기는
하이브리드 운용.

## 10. 단계별 체크리스트

```
☐ bun add -D oxlint oxlint-tsgolint
☐ .oxlintrc.json 작성 (§3.1 템플릿 사용)
☐ bun run lint — baseline error/warning 카운트 기록
☐ typescript/consistent-type-imports 만 --fix (§5.2 패턴)
☐ bun run typecheck && bun test 검증
☐ .eslintrc.* + ESLint deps 제거
☐ lefthook/CI pre-push 에 bun run lint 추가
☐ 팀 에디터 plugin 공지 (§6)
☐ 점진적으로 남은 룰 selective-fix
```

Mandu 자체는 2026-04-23 에 이 체크리스트를 완료했습니다 — 참고
commit: `5d9598d`, `965e0a5`, `f52ce17`.

## 11. 더 읽을거리

- [`docs/tooling/oxc-lint-roadmap.md`](./oxc-lint-roadmap.md) —
  Mandu 내부 도입 로드맵 (왜/어떻게 결정했는지).
- [oxlint docs](https://oxc.rs/docs/guide/usage/linter.html)
- [oxlint-tsgolint README](https://github.com/oxc-project/tsgolint)
- [typescript-go (tsgo)](https://github.com/microsoft/typescript-go)
