# Mandu Demos

Mandu 프레임워크의 주요 기능을 시연하는 데모 앱 모음입니다.

## Quick Start

```bash
cd demo/<app-name>
bun install
bun run dev
```

Default: `http://localhost:3333`

---

## Demo Apps

### `starter`

최소 구성의 Mandu 앱. 프레임워크 기본 구조를 이해하는 시작점입니다.

- `app/page.tsx` — SSR 페이지
- `app/api/health/route.ts` — Health check API (Filling API)
- `app/layout.tsx` — Root layout

**Features**: File-based routing, Filling handler API

---

### `todo-app`

CRUD 풀스택 참조 앱. Mandu의 핵심 기능을 종합적으로 시연합니다.

- REST API (GET/POST/PUT/DELETE)
- Island 컴포넌트 (`Mandu.island()` + setup/render 패턴)
- In-memory data store
- TailwindCSS 스타일링

**Features**: Filling API, Island hydration, Dynamic routes, SSR + Client interactivity

---

### `ai-chat`

SSE 스트리밍 채팅 데모. 실시간 데이터 스트리밍과 Island 인터랙션을 시연합니다.

- `Mandu.sse()` 를 사용한 Server-Sent Events 스트리밍
- Mock AI 응답 (글자 단위 스트리밍)
- 실시간 채팅 UI (Island 컴포넌트)

**Features**: SSE streaming, Island hydration, Real-time UI updates
