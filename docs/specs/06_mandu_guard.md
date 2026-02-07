# Mandu Guard

> **실시간 아키텍처 감시 시스템** - 에이전트가 아키텍처를 위반하면 즉시 경고

**Status:** Draft
**Version:** 0.1.0
**Last Updated:** 2026-02-02
**Author:** Mandu Team

---

## 목차

1. [개념 소개](#1-개념-소개)
2. [왜 필요한가?](#2-왜-필요한가)
3. [기존 도구 분석](#3-기존-도구-분석)
4. [Mandu Guard 설계](#4-mandu-guard-설계)
5. [아키텍처 프리셋](#5-아키텍처-프리셋)
6. [상세 스펙](#6-상세-스펙)
7. [사용 예시](#7-사용-예시)
8. [구현 계획](#8-구현-계획)

---

## 1. 개념 소개

### 1.1 Guard란?

**Mandu Guard**는 코드의 아키텍처 규칙을 **실시간으로 감시**하고, 위반 시 **AI Agent가 이해할 수 있는 형식**으로 경고하는 시스템입니다.

```
┌─────────────────────────────────────────────────────────────┐
│                      Mandu Guard                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [파일 저장]  →  [실시간 분석]  →  [위반 감지]  →  [경고]   │
│                                                              │
│     0.1초          import 파싱      규칙 매칭      터미널    │
│                    AST 분석                       출력       │
│                                                              │
│                         ↓                                    │
│                                                              │
│              🚨 ARCHITECTURE VIOLATION                       │
│              features → widgets (NOT ALLOWED)                │
│              ✅ Allowed: entities/*, shared/*                │
│                                                              │
│                         ↓                                    │
│                                                              │
│              AI Agent가 읽고 즉시 수정                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**핵심 원칙:** "아키텍처 위반은 저장 즉시 알려준다"

### 1.2 왜 "Guard"라고 부르는가?

| 용어 | 의미 |
|------|------|
| **Guard** | 경비원, 보호자 |
| **Architecture Guard** | 아키텍처를 지키는 보호 시스템 |

Guard는 단순한 lint가 아닙니다. **실시간으로 감시**하고, **AI Agent가 이해할 수 있도록** 경고합니다.

### 1.3 어떻게 동작하는가?

```
1. 개발자/Agent가 코드 저장
   └── src/features/auth/login.tsx

2. Guard가 파일 변경 감지
   └── chokidar 기반 실시간 감시

3. Import 문 분석
   └── import { Header } from '@/widgets/header'

4. 레이어 규칙 검증
   └── features → widgets (위반!)

5. 에이전트 친화적 경고 출력
   └── 터미널에 구조화된 메시지 표시

6. AI Agent가 경고를 읽고 수정
   └── @/shared/ui/header로 변경
```

---

## 2. 왜 필요한가?

### 2.1 문제: 에이전트는 아키텍처를 모른다

AI Agent(Claude, GPT 등)가 코드를 작성할 때:

```
❌ 문제 상황

Agent: "로그인 폼에 Header를 추가하겠습니다"

// src/features/auth/login-form.tsx
import { Header } from '@/widgets/header';  // 아키텍처 위반!

export function LoginForm() {
  return (
    <div>
      <Header />  {/* features가 widgets를 직접 import */}
      <form>...</form>
    </div>
  );
}
```

Agent는 FSD 아키텍처를 모르기 때문에 위반 사실을 인지하지 못함.

### 2.2 기존 해결책의 한계

| 도구 | 동작 시점 | 문제점 |
|------|----------|--------|
| ESLint | IDE 저장 시 | IDE 종속, Agent는 CLI에서 작업 |
| dependency-cruiser | 수동 실행 | Agent가 실행하지 않음 |
| pre-commit hook | 커밋 시 | 이미 코드 작성 완료 후 |
| CI/CD | PR 시 | 더 늦음, 수정 비용 높음 |

**공통 문제:** Agent가 코드를 작성하는 **그 순간**에 피드백이 없음

### 2.3 Mandu Guard의 해결책

```
✅ Mandu Guard 방식

Agent: "로그인 폼에 Header를 추가하겠습니다"

[파일 저장]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 ARCHITECTURE VIOLATION DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 File: src/features/auth/login-form.tsx:1
❌ Violation: import { Header } from '@/widgets/header'

🔴 Rule: features → widgets (NOT ALLOWED)
✅ Allowed: entities/*, shared/*

💡 Fix: Use @/shared/ui/header instead

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Agent: "아, widgets 대신 shared에서 import해야 하는군요. 수정하겠습니다."

import { Header } from '@/shared/ui/header';  // ✅ 올바른 import
```

### 2.4 Guard의 장점

| 장점 | 설명 |
|------|------|
| **실시간** | 파일 저장 즉시 (0.5초 이내) |
| **에이전트 친화적** | AI가 읽고 이해할 수 있는 형식 |
| **해결책 제안** | 단순 에러가 아닌 수정 방법 제공 |
| **프리셋 제공** | FSD, Clean Architecture 등 바로 사용 |
| **Zero Config** | 프리셋만 선택하면 즉시 동작 |

---

## 3. 기존 도구 분석

### 3.1 eslint-plugin-boundaries

```javascript
// eslint.config.js
{
  settings: {
    'boundaries/elements': [
      { type: 'features', pattern: 'features/*' },
      { type: 'entities', pattern: 'entities/*' },
    ],
  },
  rules: {
    'boundaries/element-types': ['error', {
      rules: [
        { from: 'features', allow: ['entities', 'shared'] },
      ],
    }],
  },
}
```

**장점:** 잘 정립된 규칙 시스템
**단점:** IDE 종속, 경고 메시지가 간결함, Agent 친화적이지 않음

### 3.2 dependency-cruiser

```javascript
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: 'features-no-widgets',
      from: { path: 'src/features' },
      to: { path: 'src/widgets' },
    },
  ],
};
```

**장점:** 강력한 규칙 정의
**단점:** 수동 실행 필요, 실시간 아님

### 3.3 eslint-plugin-fsd-lint

```javascript
rules: {
  'fsd-lint/forbidden-imports': 'error',
  'fsd-lint/no-cross-slice-dependency': 'error',
}
```

**장점:** FSD 특화
**단점:** FSD 전용, 다른 아키텍처 미지원

### 3.4 왜 충분하지 않은가?

| 기존 도구 | Mandu Guard |
|----------|-------------|
| 빌드/커밋 시 체크 | **실시간 감시** |
| 간결한 에러 메시지 | **상세한 설명 + 제안** |
| 사람용 출력 | **Agent 친화적 출력** |
| 설정 복잡 | **프리셋으로 즉시 시작** |
| 각각 별도 설치 | **Mandu에 내장** |

---

## 4. Mandu Guard 설계

### 4.1 설계 원칙

1. **실시간 우선** - 저장 즉시 감지
2. **Agent 친화적** - AI가 읽고 이해 가능
3. **프리셋 제공** - Zero Config로 시작
4. **확장 가능** - 커스텀 규칙 지원
5. **성능 최적화** - 증분 분석, 캐싱

### 4.2 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     mandu dev                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │   Watcher   │ → │  Analyzer   │ → │  Validator  │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│        │                  │                  │               │
│   chokidar            import 파싱        규칙 검증          │
│   파일 감시           AST 분석                               │
│                                                              │
│                              ↓                               │
│                                                              │
│                    ┌─────────────┐                           │
│                    │  Reporter   │                           │
│                    └─────────────┘                           │
│                          │                                   │
│                    에이전트 친화적                           │
│                    경고 출력                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 설정 방식

```typescript
// mandu.config.ts
export default {
  guard: {
    // 프리셋 사용 (권장)
    preset: "fsd",

    // 실시간 감시 (기본값: true)
    realtime: true,

    // 감시 대상 디렉토리
    srcDir: "src",

    // 제외 패턴
    exclude: ["**/*.test.ts", "**/*.spec.ts"],
  },
};
```

> 참고: 현재 `mandu dev`는 `preset/srcDir/exclude/realtime`만 읽습니다.  
> `guard arch`는 `mandu.config` 값을 기본값으로 사용하며, CLI 옵션이 우선합니다.

### 4.4 핵심 결정 사항

| 항목 | 결정 | 이유 |
|------|------|------|
| 설정 위치 | `mandu.config.ts` | 통합 관리, 타입 지원 |
| 기본 프리셋 | `mandu` (FSD 기반) | Agent-Native에 최적 |
| 감시 방식 | chokidar | 크로스 플랫폼, 성능 |
| 분석 방식 | 정규식 + AST 하이브리드 | 속도와 정확도 균형 |
| 경고 형식 | 구조화된 텍스트 | AI 파싱 용이 |

---

## 5. 아키텍처 프리셋

### 5.1 FSD (Feature-Sliced Design)

프론트엔드 권장 아키텍처.

```
src/
├── app/        # 앱 진입점, 프로바이더
├── pages/      # 페이지 컴포넌트
├── widgets/    # 독립적인 UI 블록
├── features/   # 비즈니스 기능
├── entities/   # 비즈니스 엔티티
└── shared/     # 공유 유틸, UI
```

**의존성 규칙:**
```
app      → pages, widgets, features, entities, shared
pages    → widgets, features, entities, shared
widgets  → features, entities, shared
features → entities, shared
entities → shared
shared   → (nothing)
```

**사용법:**
```typescript
guard: {
  preset: "fsd",
}
```

### 5.2 Clean Architecture

백엔드 권장 아키텍처.

```
src/modules/{domain}/
├── api/          # Controllers, Routes
├── application/  # Use Cases, Services
├── domain/       # Entities, Value Objects
└── infra/        # Repositories, External APIs

src/core/         # 공통 핵심 (auth, config)
src/shared/       # 공유 유틸리티
```

**의존성 규칙:**
```
api         → application (only)
application → domain, core, shared
domain      → shared (only)
infra       → application, domain, core, shared
core        → shared
shared      → (nothing)
```

**사용법:**
```typescript
guard: {
  preset: "clean",
}
```

### 5.3 Hexagonal Architecture

포트와 어댑터 패턴.

```
src/
├── adapters/
│   ├── in/       # Driving adapters (controllers)
│   └── out/      # Driven adapters (repositories)
├── application/  # Use cases
├── domain/       # Pure business logic
└── ports/        # Interfaces
```

**의존성 규칙:**
```
adapters/in  → application, ports
adapters/out → application, ports
application  → domain, ports
domain       → (nothing - pure)
ports        → domain
```

**사용법:**
```typescript
guard: {
  preset: "hexagonal",
}
```

### 5.4 Atomic Design

UI 컴포넌트 아키텍처.

```
src/components/
├── templates/   # 페이지 템플릿
├── organisms/   # 복잡한 UI 블록
├── molecules/   # 조합된 컴포넌트
└── atoms/       # 기본 요소
```

**의존성 규칙:**
```
templates → organisms, molecules, atoms
organisms → molecules, atoms
molecules → atoms
atoms     → (nothing)
```

**사용법:**
```typescript
guard: {
  preset: "atomic",
}
```

### 5.5 커스텀 아키텍처

프리셋 없이 직접 정의:

```typescript
guard: {
  layers: [
    {
      name: "controllers",
      pattern: "src/controllers/**",
      canImport: ["services", "utils"],
    },
    {
      name: "services",
      pattern: "src/services/**",
      canImport: ["repositories", "utils"],
    },
    {
      name: "repositories",
      pattern: "src/repositories/**",
      canImport: ["models", "utils"],
    },
    {
      name: "models",
      pattern: "src/models/**",
      canImport: ["utils"],
    },
    {
      name: "utils",
      pattern: "src/utils/**",
      canImport: [],
    },
  ],
}
```

---

## 6. 상세 스펙

### 6.1 에이전트 친화적 경고 형식

Guard의 핵심 차별점은 AI Agent가 이해할 수 있는 경고 형식입니다.

**형식:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 ARCHITECTURE VIOLATION DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 File: {filePath}
📍 Line: {line}, Column: {column}
❌ Violation: {importStatement}

🔴 Rule: {ruleName}
   {ruleDescription}

📊 Layer Hierarchy:
   {visualHierarchy}

✅ Allowed imports from "{fromLayer}":
   • {allowedLayer1}
   • {allowedLayer2}

💡 Suggestions:
   {suggestion1}
   {suggestion2}

📚 Learn more: {documentationLink}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**실제 예시:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 ARCHITECTURE VIOLATION DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 File: src/features/auth/login-form.tsx
📍 Line: 3, Column: 1
❌ Violation: import { Header } from '@/widgets/header'

🔴 Rule: FSD Layer Dependency
   "features" layer cannot import from "widgets" layer

📊 Layer Hierarchy (top → bottom):
   app → pages → widgets → features → entities → shared
                    ↑          ↓
                 (violation: features importing UP)

✅ Allowed imports from "features":
   • @/entities/*
   • @/shared/*

💡 Suggestions:
   1. Move Header to @/shared/ui/header
   2. Pass Header as prop from parent widget
   3. Create feature-specific header in @/features/auth/ui

📚 Learn more: https://feature-sliced.design/docs/reference/layers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 6.2 위반 심각도

| 심각도 | 표시 | 설명 |
|--------|------|------|
| `error` | 🚨 | 즉시 수정 필요 |
| `warn` | ⚠️ | 권장 수정 |
| `info` | ℹ️ | 참고 사항 |

```typescript
guard: {
  severity: {
    layerViolation: "error",      // 레이어 위반
    circularDependency: "warn",   // 순환 의존
    deepNesting: "info",          // 깊은 중첩
  },
}
```

### 6.3 실시간 감시 시스템

**감시 대상:**
- `*.ts`, `*.tsx`, `*.js`, `*.jsx` 파일
- 변경(change), 추가(add), 삭제(unlink) 이벤트

**성능 최적화:**
```typescript
{
  // 파일 캐시 - 변경 없으면 재분석 안 함
  cache: true,

  // 증분 분석 - 변경된 import만 검증
  incremental: true,

  // debounce - 연속 저장 시 마지막만 분석
  debounceMs: 100,
}
```

### 6.4 Import 분석

Guard가 분석하는 import 유형:

```typescript
// ESM static import
import { X } from 'module';
import X from 'module';
import * as X from 'module';

// ESM dynamic import
const X = await import('module');

// CommonJS (선택적)
const X = require('module');
```

### 6.5 FS Routes 통합

Guard는 FS Routes의 `app/` 폴더 내부에도 규칙을 적용할 수 있습니다:

```typescript
guard: {
  preset: "fsd",

  // app/ 내부 추가 규칙
  fsRoutes: {
    // page.tsx에서 다른 page import 금지
    noPageToPage: true,

    // page.tsx가 import 가능한 레이어
    pageCanImport: ["widgets", "features", "entities", "shared"],

    // layout.tsx가 import 가능한 레이어
    layoutCanImport: ["widgets", "shared"],
  },
}
```

---

## 7. 사용 예시

### 7.1 기본 사용 (프리셋)

```typescript
// mandu.config.ts
export default {
  guard: {
    preset: "fsd",
  },
};
```

```bash
# 개발 서버 시작 시 Guard 자동 활성화
mandu dev

# 일회성 전체 검사 (CI용)
mandu guard

# 위반 개수만 출력
mandu guard --quiet
```

### 7.2 프리셋 오버라이드

```typescript
guard: {
  preset: "fsd",

  // 프리셋 규칙 수정
  override: {
    // features에서 widgets import 허용 (권장하지 않음)
    layers: {
      features: {
        canImport: ["widgets", "entities", "shared"],
      },
    },
  },
}
```

### 7.3 다중 아키텍처 (모노레포)

```typescript
guard: {
  // 경로별 다른 프리셋
  zones: [
    {
      path: "apps/web/**",
      preset: "fsd",
    },
    {
      path: "apps/api/**",
      preset: "clean",
    },
    {
      path: "packages/ui/**",
      preset: "atomic",
    },
  ],
}
```

### 7.4 특정 파일 예외 처리

```typescript
guard: {
  preset: "fsd",

  // 특정 파일 제외
  exclude: [
    "**/*.test.ts",
    "**/*.stories.tsx",
    "**/legacy/**",
  ],

  // 특정 import 무시
  ignoreImports: [
    // 테스트 유틸은 어디서나 import 가능
    "@/test/**",
  ],
}
```

### 7.5 CI/CD 통합

```yaml
# .github/workflows/guard.yml
name: Architecture Guard

on: [push, pull_request]

jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - run: bun install
      - run: bun mandu guard --ci
        # --ci: 에러 시 exit code 1
```

---

## 8. 구현 계획

### 8.1 마일스톤

```
Phase 1: 기본 인프라 (MVP)
├── guard/types.ts - 타입 정의
├── guard/watcher.ts - 파일 감시 (chokidar)
├── guard/analyzer.ts - Import 분석 (정규식)
├── guard/validator.ts - 규칙 검증
├── guard/reporter.ts - 콘솔 경고 출력
└── 예상: 2-3일

Phase 2: 프리셋 시스템
├── presets/fsd.ts - FSD 프리셋
├── presets/clean.ts - Clean Architecture
├── config 스키마 확장
└── 예상: 1-2일

Phase 3: 에이전트 최적화
├── 경고 형식 개선
├── 해결 제안 생성기
├── 문서 링크 연결
└── 예상: 1일

Phase 4: FS Routes 통합
├── 공통 watcher 사용
├── app/ 내부 규칙 지원
├── dev 서버 통합
└── 예상: 1일

Phase 5: 고급 기능
├── 추가 프리셋 (hexagonal, atomic)
├── AST 기반 정밀 분석
├── 위반 통계/리포트
├── mandu guard CLI 명령어
└── 예상: 2-3일
```

### 8.2 구현 파일 구조

```
packages/core/src/guard/
├── index.ts           # Public API
├── types.ts           # 타입 정의
├── watcher.ts         # 파일 감시
├── analyzer.ts        # Import 분석
├── validator.ts       # 규칙 검증
├── reporter.ts        # 경고 출력
├── config.ts          # 설정 로더
└── presets/
    ├── index.ts       # 프리셋 export
    ├── fsd.ts         # FSD
    ├── clean.ts       # Clean Architecture
    ├── hexagonal.ts   # Hexagonal
    └── atomic.ts      # Atomic Design
```

### 8.3 Phase 1 상세 태스크

```
[ ] guard/types.ts
    - GuardConfig 인터페이스
    - Layer, LayerRule 타입
    - Violation, ViolationReport 타입
    - Preset 타입

[ ] guard/watcher.ts
    - createGuardWatcher() - chokidar 설정
    - watchFiles() - 파일 감시 시작
    - onFileChange() - 변경 이벤트 핸들러

[ ] guard/analyzer.ts
    - analyzeFile() - 파일 분석
    - extractImports() - import 문 추출
    - resolveLayer() - import 경로 → 레이어 매핑

[ ] guard/validator.ts
    - validateImports() - 규칙 검증
    - checkLayerDependency() - 레이어 의존성 체크
    - createViolation() - 위반 객체 생성

[ ] guard/reporter.ts
    - formatViolation() - 에이전트 친화적 형식
    - printToConsole() - 터미널 출력
    - generateSuggestions() - 해결 제안 생성

[ ] 테스트
    - tests/guard/analyzer.test.ts
    - tests/guard/validator.test.ts
```

---

## 부록

### A. 타입 정의

```typescript
// guard/types.ts

export interface GuardConfig {
  /** 프리셋 이름 */
  preset?: "fsd" | "clean" | "hexagonal" | "atomic" | "mandu";

  /** 실시간 감시 여부 */
  realtime?: boolean;

  /** 감시 대상 디렉토리 */
  srcDir?: string;

  /** 제외 패턴 */
  exclude?: string[];

  /** 커스텀 레이어 정의 */
  layers?: LayerDefinition[];

  /** 심각도 설정 */
  severity?: SeverityConfig;

  /** FS Routes 통합 */
  fsRoutes?: FSRoutesGuardConfig;
}

export interface LayerDefinition {
  /** 레이어 이름 */
  name: string;

  /** 파일 패턴 (glob) */
  pattern: string;

  /** import 가능한 레이어 목록 */
  canImport: string[];
}

export interface Violation {
  /** 위반 파일 경로 */
  filePath: string;

  /** 라인 번호 */
  line: number;

  /** 컬럼 번호 */
  column: number;

  /** 위반 import 문 */
  importStatement: string;

  /** 소스 레이어 */
  fromLayer: string;

  /** 타겟 레이어 */
  toLayer: string;

  /** 규칙 이름 */
  ruleName: string;

  /** 심각도 */
  severity: "error" | "warn" | "info";

  /** 허용된 레이어 목록 */
  allowedLayers: string[];

  /** 해결 제안 */
  suggestions: string[];
}
```

### B. 프리셋 비교표

| 프리셋 | 대상 | 레이어 | 특징 |
|--------|------|--------|------|
| `fsd` | 프론트엔드 | app, pages, widgets, features, entities, shared | 기능 중심 |
| `clean` | 백엔드 | api, application, domain, infra | 의존성 역전 |
| `hexagonal` | 백엔드 | adapters, application, domain, ports | 포트와 어댑터 |
| `atomic` | UI | templates, organisms, molecules, atoms | 컴포넌트 계층 |
| `mandu` | 풀스택 | FSD + Clean 조합 | Mandu 권장 |

### C. eslint-plugin-boundaries 마이그레이션

기존 boundaries 설정을 Mandu Guard로 마이그레이션:

**Before (eslint):**
```javascript
settings: {
  'boundaries/elements': [
    { type: 'features', pattern: 'features/*' },
    { type: 'entities', pattern: 'entities/*' },
  ],
},
rules: {
  'boundaries/element-types': ['error', {
    rules: [
      { from: 'features', allow: ['entities', 'shared'] },
    ],
  }],
}
```

**After (Mandu Guard):**
```typescript
guard: {
  preset: "fsd", // 또는 커스텀
}
```

---

*이 문서는 Mandu Guard 시스템의 기획 문서입니다. 구현 과정에서 변경될 수 있습니다.*
