# Mandu

Bun 기반 풀스택 React 프레임워크. Island 아키텍처, AI 네이티브 도구, 구조 가드레일을 제공합니다.

Mandu는 SSR과 스트리밍을 기본 탑재하고, Island을 통해 페이지에 실제로 필요한 JavaScript만 전달하며, 85개 MCP 도구와 9개 스킬 파일을 통해 AI 코딩 에이전트와 직접 연동됩니다.

## 빠른 시작

```bash
bunx @mandujs/cli init my-app
cd my-app
bun run dev
```

`http://localhost:3333`에서 앱이 실행됩니다.

## 주요 기능

### Island 아키텍처

모든 인터랙티브 컴포넌트는 Island입니다. 하이드레이션 시점을 직접 선택합니다.

```tsx
import { island } from "@mandujs/core";

export default island("visible", ({ name }) => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((c) => c + 1)}>{name}: {count}</button>;
});
```

5가지 하이드레이션 전략: `load` (즉시), `idle` (requestIdleCallback), `visible` (IntersectionObserver), `media` (미디어 쿼리 매치), `never` (SSR 전용, JS 없음).

### Filling API

8단계 라이프사이클을 갖춘 타입 안전 HTTP 핸들러.

```
onRequest -> onParse -> beforeHandle -> handler -> afterHandle -> mapResponse -> onError -> afterResponse
```

```ts
export const api = filling({
  method: "POST",
  path: "/users",
  contract: { body: UserSchema },
  handler: async ({ body }) => ({ id: crypto.randomUUID(), ...body }),
});
```

동일한 라이프사이클 모델로 `filling.ws()`를 통한 WebSocket도 지원합니다.

### Contract API

런타임 검증과 OpenAPI 생성을 동시에 구동하는 Zod 기반 스키마.

```ts
import { contract } from "@mandujs/core";

export const UserContract = contract({
  body: z.object({ name: z.string(), email: z.string().email() }),
  response: z.object({ id: z.string(), name: z.string() }),
});
```

`mandu contract`로 모든 계약을 검증하고, `mandu openapi`로 스펙을 생성합니다.

### Guard 시스템

파일시스템 수준에서 프로젝트 구조 컨벤션을 강제합니다. 6개 프리셋 제공.

| 프리셋 | 아키텍처 |
|--------|----------|
| `fsd` | Feature-Sliced Design |
| `clean` | 클린 아키텍처 |
| `hexagonal` | 헥사고날 / 포트 & 어댑터 |
| `atomic` | 아토믹 디자인 |
| `cqrs` | Command Query Responsibility Segregation |
| `mandu` | Mandu 기본 컨벤션 |

```bash
mandu guard-check          # 구조 검증
mandu guard-check --fix    # 위반 사항 자동 수정
```

### 렌더링

- **SSR** -- 자동 `<head>` 관리를 포함한 서버사이드 렌더링
- **Streaming SSR** -- 대규모 페이지를 위한 점진적 HTML 스트리밍
- **ISR / SWR** -- `revalidatePath()`, `revalidateTag()`를 사용한 증분 정적 재생성
- **View Transitions** -- 라우트 전환 시 자동 트랜지션

### 데이터 로딩

**Slot**은 렌더링 전에 실행되어 페이지에 타입이 지정된 props를 주입하는 서버사이드 데이터 로더입니다. 라우트 옆에 `page.slot.ts`를 정의하면 데이터가 props로 사용 가능합니다. **미들웨어**는 프로젝트 루트의 `middleware.ts` 컨벤션으로 전역 실행됩니다.

### 세션과 인증

`createCookieSessionStorage`를 통한 쿠키 기반 세션. `mandu auth`로 인증 보일러플레이트를, `mandu session`으로 세션 처리를 스캐폴딩합니다.

### 클라이언트 훅

| 훅 | 용도 |
|----|------|
| `useMandu()` | 프레임워크 컨텍스트 (라우트, 파라미터, 네비게이션) |
| `useLoaderData()` | Slot 데이터 접근 |
| `useActionData()` | 폼 액션 결과 접근 |
| `useSubmit()` | 프로그래밍 방식 폼 제출 |
| `useFetch()` | SWR 시맨틱 데이터 페칭 |
| `useHead()` | 문서 head 관리 |
| `useSeoMeta()` | SEO 메타 태그 |

`<Form>` 컴포넌트를 통한 프로그레시브 인핸스먼트. `createClient` RPC를 통한 타입 안전 서버 호출.

### 추가 기능

- **이미지 최적화** -- `/_mandu/image` 엔드포인트, sharp 사용, 자동 포맷 변환
- **Content Collections** -- 프론트매터가 포함된 Markdown/MDX, `mandu collection`으로 사용
- **어댑터 시스템** -- `adapterBun` 내장, 다른 런타임으로 확장 가능

## CLI

38개 명령어가 도메인별로 구성되어 있습니다.

| 카테고리 | 명령어 |
|----------|--------|
| **코어** | `dev`, `build`, `start`, `preview`, `clean`, `info` |
| **품질** | `guard-check`, `contract`, `doctor`, `explain`, `fix` |
| **스캐폴딩** | `init`, `scaffold`, `add`, `middleware`, `session`, `ws`, `auth`, `collection` |
| **AI** | `ask`, `review`, `generate --ai`, `mcp` |
| **운영** | `deploy`, `upgrade`, `completion`, `cache`, `lock`, `monitor` |

전체 목록은 `mandu --help`로 확인하세요.

## MCP 연동

Mandu는 18개 카테고리에 걸쳐 85개 도구를 갖춘 MCP 서버(`@mandujs/mcp`)를 제공합니다.

```bash
mandu mcp                # MCP 서버 시작
mandu mcp --profile full # 전체 85개 도구
mandu mcp --profile minimal # 필수 도구만
```

도구 카테고리는 점 표기법을 사용합니다: `guard.check`, `contract.validate`, `slot.create`, `seo.audit`, `brain.explain`, `runtime.status` 등.

3개 프롬프트, 3개 리소스, 그리고 멀티 에이전트 안전을 위한 트랜잭션 잠금을 포함합니다.

## Skills

`@mandujs/skills` npm 패키지는 Claude Code 플러그인으로 동작하는 9개 SKILL.md 파일을 제공합니다.

| 스킬 | 범위 |
|------|------|
| `mandu-create-api` | API 라우트 스캐폴딩 |
| `mandu-create-feature` | 기능 모듈 생성 |
| `mandu-debug` | 디버깅 가이드 |
| `mandu-deploy` | 배포 워크플로 |
| `mandu-explain` | 코드베이스 설명 |
| `mandu-fs-routes` | 파일시스템 라우팅 |
| `mandu-guard-guide` | Guard 설정 |
| `mandu-hydration` | Island 하이드레이션 패턴 |
| `mandu-slot` | 데이터 로더 패턴 |

## 프로젝트 구조

```
app/                  # 페이지, 레이아웃, Island
  page.tsx            # 라우트 컴포넌트
  page.slot.ts        # 서버사이드 데이터 로더
  layout.tsx          # 레이아웃 래퍼
  *.island.tsx        # 인터랙티브 Island
middleware.ts         # 전역 미들웨어
mandu.config.ts       # 프레임워크 설정
.mandu/               # 빌드 출력 (자동 생성)
```

## 설정

프로젝트 루트의 `mandu.config.ts`로 설정합니다. 서버, 개발, 빌드, Guard 설정을 지원합니다. CLI 플래그가 설정값보다 우선합니다. 전체 레퍼런스는 `docs/guides/01_configuration.ko.md`를 참고하세요.

## 문서

| 문서 | 경로 |
|------|------|
| 설정 가이드 | `docs/guides/01_configuration.ko.md` |
| API 레퍼런스 | `docs/api/api-reference.ko.md` |
| 구현 현황 | `docs/status.ko.md` |
| 기술 아키텍처 | `docs/architecture/02_mandu_technical_architecture.md` |
| FS Routes 스펙 | `docs/specs/05_fs_routes_system.md` |
| Guard 스펙 | `docs/specs/06_mandu_guard.md` |
| SEO 모듈 | `docs/specs/07_seo_module.md` |

## 라이선스

MPL-2.0. 수정한 파일은 공개가 필요합니다. Mandu로 만든 앱은 자유로운 라이선스를 적용할 수 있습니다.
