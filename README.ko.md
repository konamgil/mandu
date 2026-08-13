<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu 로고" width="160" />
</p>

<h1 align="center">Mandu</h1>

<p align="center">
  <strong>Bun과 React를 위한 Agent-Safe 풀스택 프레임워크.</strong><br/>
  AI 에이전트가 코드를 변경해도 아키텍처, 계약, 빌드 상태를 안전하게 유지합니다.
</p>

<p align="center">
  <a href="https://mandujs.com">웹사이트</a> |
  <a href="https://mandujs.com/docs">문서</a> |
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mandujs/core"><img src="https://img.shields.io/npm/v/@mandujs/core?label=core" alt="npm core 버전" /></a>
  <a href="https://www.npmjs.com/package/@mandujs/cli"><img src="https://img.shields.io/npm/v/@mandujs/cli?label=cli" alt="npm cli 버전" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun 런타임" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MPL--2.0-blue" alt="MPL-2.0 라이선스" />
</p>

---

> **개편 상태:** Mandu v0.x는 초기 베타입니다. Agent-Safe 제품 계약은 합의된 v1 방향이며 typed apply와 전체 신뢰성 gate는 아직 구현 중입니다. [제품 전략](./docs/product/03_agent_safe_refoundation_strategy.md)과 [실행 계획](./docs/plans/22_mandu_refoundation_execution_plan.md)을 확인하세요.

## 왜 Mandu인가요?

AI는 코드를 빠르게 씁니다. 진짜 어려운 일은 여러 번의 변경 뒤에도 앱을 이해 가능한 상태로 유지하는 것입니다.

Mandu는 집중된 풀스택 런타임에 계약, 아키텍처 가드, 통제된 에이전트 워크플로를 결합합니다. 사람과 에이전트가 코드를 바꿔도 프로젝트가 유효한 상태를 잃지 않게 돕습니다.

| 원하는 것 | Mandu가 주는 것 |
|-----------|-----------------|
| 풀스택 React 앱 | 파일 기반 페이지와 API 라우트 |
| 더 적은 클라이언트 JavaScript | island hydration과 서버 렌더링 |
| 안전한 API 변경 | Zod contract, typed handler, OpenAPI 출력 |
| 더 나은 AI 생성 코드 | Guard 규칙, MCP 도구, Mandu 전용 skill |
| 빠른 로컬 개발 | Bun 네이티브 dev, build, test 명령 |

짧게 말하면, Mandu는 실제 변경을 AI 에이전트에게 맡기면서도 아키텍처와 릴리즈 품질은 직접 책임지는 개발자를 위한 프레임워크입니다.

## 1분 만에 시작하기

```bash
bunx @mandujs/cli create my-app --yes
cd my-app
bun install
bun run dev
```

브라우저에서 `http://localhost:3333`을 여세요.

실시간 채팅 스타터를 쓰고 싶다면:

```bash
bunx @mandujs/cli create my-chat --template realtime-chat --yes
```

매번 `bunx`를 쓰기보다 `mandu` 명령을 먼저 설치하고 싶다면:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/konamgil/mandu/main/install.sh | sh

# Windows PowerShell
iwr https://raw.githubusercontent.com/konamgil/mandu/main/install.ps1 -useb | iex
```

그 다음 `mandu create my-app --yes`를 실행하세요.

## 페이지 만들기

`app/page.tsx`를 만드세요:

```tsx
export default function Home() {
  return (
    <main>
      <h1>Hello from Mandu</h1>
      <p>이 파일을 수정하면 화면이 바로 갱신됩니다.</p>
    </main>
  );
}
```

## API 라우트 만들기

`app/api/hello/route.ts`를 만드세요:

```ts
export function GET() {
  return Response.json({ message: "Hello from Mandu" });
}
```

`http://localhost:3333/api/hello`에서 확인할 수 있습니다.

## 프로젝트 구조

```text
my-app/
|-- app/          # 페이지, 레이아웃, API 라우트
|-- src/
|   |-- client/  # 브라우저 코드
|   |-- server/  # 서버 코드
|   `-- shared/  # contract, type, 공용 유틸
|-- spec/         # contract, slot, 아키텍처 메타데이터
`-- .mandu/       # 생성된 결과물
```

처음에는 `app/`만으로 시작해도 됩니다. 앱이 커질 때 contract, slot, guard 규칙을 추가하세요.

## 에이전트를 위해 설계됨

Mandu는 AI 에이전트가 실제로 수정하는 코드베이스를 전제로 설계되었습니다.

- CLI가 route, API, contract, 프로젝트 구조를 만들 수 있습니다.
- Guard 규칙이 아키텍처 이탈을 초기에 잡아줍니다.
- MCP 도구와 Mandu skill은 에이전트가 단순 텍스트 편집이 아니라 프로젝트를 이해한 작업을 하게 돕습니다.
- 릴리즈 체크는 생성된 코드를 리뷰 가능한 상태로 유지하는 데 도움을 줍니다.

자세한 흐름은 [Mandu Agent Workflow](./docs/guides/07_agent_workflow.md)를 보세요.

## 더 깊게 읽기

- [Agent-Safe 제품 전략](./docs/product/03_agent_safe_refoundation_strategy.md)
- [공식 문서](https://mandujs.com/docs)
- [로컬 문서 인덱스](./docs/README.ko.md)
- [CLI 레퍼런스](./packages/cli/README.md)
- [Core 패키지](./packages/core/README.md)
- [설치 가이드](./docs/install.md)

## 요구사항

- Bun `>= 1.3.12`
- TypeScript
- React 19

## 라이선스

Mandu는 [MPL-2.0](./LICENSE) 라이선스를 따릅니다.
