<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu" width="200" />
</p>

<h1 align="center">@mandujs/cli</h1>

<p align="center">
  <strong>Agent-Native Fullstack Framework CLI</strong><br/>
  에이전트가 코딩해도 아키텍처가 무너지지 않는 개발 OS
</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> | 한국어
</p>

## 설치

```bash
# Bun 필수
bun add -D @mandujs/cli
```

## 빠른 시작

```bash
# 새 프로젝트 생성
bunx @mandujs/cli init my-app
cd my-app

# 개발 서버 시작
bun run dev
```

## 명령어

### `mandu init <project-name>`

새 Mandu 프로젝트를 생성합니다.

```bash
bunx @mandujs/cli init my-app
```

생성되는 구조:
```
my-app/
├── app/                 # FS Routes
│   └── page.tsx         # /
├── src/                 # 아키텍처 레이어
│   ├── client/          # 클라이언트 (FSD)
│   │   ├── app/
│   │   ├── pages/
│   │   ├── widgets/
│   │   ├── features/
│   │   ├── entities/
│   │   └── shared/
│   ├── server/          # 서버 (Clean)
│   │   ├── api/
│   │   ├── application/
│   │   ├── domain/
│   │   ├── infra/
│   │   └── core/
│   └── shared/          # 공용
│       ├── contracts/        # client-safe 계약
│       ├── types/
│       ├── utils/
│       │   ├── client/       # 클라이언트 safe 유틸
│       │   └── server/       # 서버 전용 유틸
│       ├── schema/           # 서버 전용 스키마
│       └── env/              # 서버 전용 환경
├── apps/
│   ├── server/main.ts    # 서버 진입점
│   └── web/entry.tsx     # 클라이언트 진입점
├── spec/
│   └── routes.manifest.json  # SSOT - 라우트 정의
├── package.json
└── tsconfig.json
```

### `mandu dev`

개발 서버를 시작합니다 (HMR 지원).

```bash
bun run dev
# 또는
bunx mandu dev
```

### `mandu spec`

spec 파일을 검증하고 lock 파일을 갱신합니다.

```bash
bun run spec
```

### `mandu generate`

spec 기반으로 코드를 생성합니다.

```bash
bun run generate
```

### `mandu guard`

아키텍처 규칙을 검사합니다. (기본: mandu 프리셋)

```bash
bun run guard

# 프리셋 변경
bunx mandu guard --preset fsd

# CI 모드 (warning도 실패 처리)
bunx mandu guard --ci
```

### `mandu guard legacy`

레거시 Spec Guard 검사 + 자동 수정입니다.

```bash
bunx mandu guard legacy

# 자동 수정 비활성화
bunx mandu guard legacy --no-auto-correct
```

자동 수정 가능한 규칙(legacy):
- `SPEC_HASH_MISMATCH` → lock 파일 갱신
- `GENERATED_MANUAL_EDIT` → 코드 재생성
- `SLOT_NOT_FOUND` → slot 파일 생성

### `mandu contract build`

계약 레지스트리(`.mandu/contracts.json`)를 생성합니다.

```bash
bunx mandu contract build
```

### `mandu contract diff`

계약 변경사항(major/minor/patch)을 비교합니다.

```bash
bunx mandu contract diff
```

## Spec 파일 작성

`spec/routes.manifest.json`이 모든 라우트의 단일 진실 공급원(SSOT)입니다.

```json
{
  "version": "1.0.0",
  "routes": [
    {
      "id": "getUsers",
      "pattern": "/api/users",
      "kind": "api",
      "module": "apps/server/api/users.ts"
    },
    {
      "id": "homePage",
      "pattern": "/",
      "kind": "page",
      "module": "apps/server/pages/home.ts",
      "componentModule": "apps/web/pages/Home.tsx"
    }
  ]
}
```

### Slot 시스템 (v0.2.0+)

비즈니스 로직을 분리하려면 `slotModule`을 추가합니다:

```json
{
  "id": "getUsers",
  "pattern": "/api/users",
  "kind": "api",
  "module": "apps/server/api/users.generated.ts",
  "slotModule": "apps/server/api/users.slot.ts"
}
```

- `*.generated.ts` - 프레임워크가 관리 (수정 금지)
- `*.slot.ts` - 개발자가 작성하는 비즈니스 로직

## 개발 워크플로우

```bash
# 1. spec 수정
# 2. spec 검증 및 lock 갱신
bun run spec

# 3. 코드 생성
bun run generate

# 4. 아키텍처 검사
bun run guard

# 5. 테스트
bun test

# 6. 개발 서버
bun run dev
```

## 테스트

Bun 테스트 프레임워크를 기본 지원합니다.

```bash
bun test           # 테스트 실행
bun test --watch   # 감시 모드
```

## 요구 사항

- Bun >= 1.0.0
- React >= 18.0.0

## 관련 패키지

- [@mandujs/core](https://www.npmjs.com/package/@mandujs/core) - 핵심 런타임

## 라이선스

MIT
