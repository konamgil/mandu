# Mandu Demos

Mandu의 안정 제품은 세 reference workflow로 검증합니다.

## 공식 reference workflows

| 사용자 여정 | 위치 | 핵심 검증 |
|---|---|---|
| SaaS dashboard | `demo/auth-starter` | session/CSRF, 보호 route, 동적 SSR |
| Contract CRUD | `demo/todo-app` | CRUD API, contract/resource, Island hydration |
| Interactive realtime | `packages/cli/templates/realtime-chat` | fresh create/install, chat UI, health/messages/SSE |

전체 계약은 저장소 루트에서 실행합니다.

```bash
bun install --frozen-lockfile
bun run test:reference-apps
```

개별 workspace demo 실행:

```bash
cd demo/auth-starter # 또는 demo/todo-app
bun run dev
```

`auth-starter`의 인증 페이지는 cookie에 의존하므로 prerender하지 않습니다.
`todo-app`은 SSR, hydrated CRUD 화면, JSON API를 함께 검증합니다.
`realtime-chat`은 배포된 starter와 같은 public create 경로로 임시 생성한 뒤
검증하므로 demo 폴더에 복제본을 두지 않습니다.

## Supporting / Labs demos

- `starter`: 최소 SSR/Filling 예제. 첫 생성 흐름은 `test:smoke`가 소유합니다.
- `ai-chat`: AI/SSE 실험용 Labs 데모.
- `desktop-starter`, `edge-workers-starter`: 선택 설치 target/Labs 데모.

Supporting/Labs 데모는 유용한 실험을 보존하지만 stable Core/CLI/MCP의
Golden Path나 product release contract를 정의하지 않습니다.
