# Realtime Chat Starter Template

Mandu now ships an official realtime chat starter template for production-like validation.

## Create Project

```bash
bunx @mandujs/cli init my-chat-app --template realtime-chat
cd my-chat-app
bun install
bun run dev
```

## Included by Default

- **Chat UI page** (`app/page.tsx`)
- **Message API endpoint** (`app/api/chat/messages/route.ts`)
- **SSE stream endpoint** (`app/api/chat/stream/route.ts`)
- **Typed client utilities & hook** (`src/client/features/chat/*`)
- **Optional AI adapter interface** (`src/server/application/ai-adapter.ts`)
- **Starter smoke tests** (`tests/chat-starter.test.ts`)

## API Overview

### `GET /api/chat/messages`
Returns current in-memory chat history.

### `POST /api/chat/messages`
Accepts:

```json
{ "text": "hello" }
```

Stores user message and appends assistant response via adapter.

### `GET /api/chat/stream`
Server-Sent Events stream with:

- `snapshot` (initial messages)
- `message` (new message)
- `heartbeat` (keepalive)

## Adapter Extension

Replace default echo behavior by implementing `AIChatAdapter` and injecting via `setAIAdapter`.

```ts
import { setAIAdapter } from "@/server/application/ai-adapter";

setAIAdapter({
  async complete({ userText, history }) {
    // call your LLM/provider here
    return `Model reply to: ${userText} (${history.length} messages)`;
  },
});
```
