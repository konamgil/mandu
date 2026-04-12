import type { ChatSession, Message } from "../shared/types";
import db from "./db";

const DEFAULT_SYSTEM_PROMPT =
  "당신은 Mandu 프레임워크 전문가입니다. Mandu의 기능과 사용법에 대해 친절하고 상세하게 설명합니다. 코드 예시를 적극 활용하세요.";

const STREAM_CHUNK_SIZE = 18;

const MOCK_RESPONSES = [
  `## Mandu 프레임워크란?

Mandu는 **Bun** 기반의 모던 풀스택 프레임워크입니다.

### 핵심 특징
- 🏝️ **Island 아키텍처**: 필요한 부분만 하이드레이션
- ⚡ **SSE 스트리밍**: 실시간 서버 → 클라이언트 통신
- 📋 **Contract API**: Zod 기반 타입 안전한 API
- 🔧 **Filling API**: 선언적 핸들러 체이닝

\`\`\`typescript
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => ctx.ok({ message: "Hello!" }));
\`\`\``,

  `## SSE (Server-Sent Events) 스트리밍

SSE는 서버에서 클라이언트로 **단방향 실시간 데이터**를 전송하는 기술입니다.

### WebSocket vs SSE
| 특성 | SSE | WebSocket |
|------|-----|-----------|
| 방향 | 단방향 (서버→클라) | 양방향 |
| 프로토콜 | HTTP | WS |
| 복잡도 | **낮음** | 높음 |
| 자동 재연결 | ✅ | ❌ |

\`\`\`typescript
const sse = Mandu.sse(ctx.request.signal);
sse.send({ token: "hello" }, { event: "token" });
await sse.close();
\`\`\``,

  `## Filling API - 핸들러 체이닝

Mandu의 \`filling()\`은 HTTP 메서드별 핸들러를 **체이닝** 방식으로 정의합니다.

### 라이프사이클 훅
1. \`onRequest\` → 요청 수신
2. \`beforeHandle\` → 인증/검증
3. **핸들러 실행**
4. \`afterHandle\` → 응답 후처리
5. \`mapResponse\` → 응답 변환

\`\`\`typescript
export default Mandu.filling()
  .beforeHandle(async (ctx) => {
    if (!ctx.headers.get("Authorization")) {
      return ctx.unauthorized();
    }
  })
  .get((ctx) => ctx.ok({ data: "protected" }))
  .post(async (ctx) => {
    const body = await ctx.body<{ name: string }>();
    return ctx.created({ name: body.name });
  });
\`\`\``,

  `## Island 컴포넌트 패턴

Island은 **선택적 하이드레이션** 패턴입니다. 정적 HTML 중 인터랙티브한 부분만 클라이언트에서 활성화합니다.

### setup/render 패턴

\`\`\`typescript
import { island } from "@mandujs/core/client";

export default island<{ count: number }>({
  setup: (serverData) => {
    const [count, setCount] = useState(serverData.count);
    const increment = useCallback(() => {
      setCount(c => c + 1);
    }, []);
    return { count, increment };
  },
  render: ({ count, increment }) => (
    <button onClick={increment}>
      Count: {count}
    </button>
  ),
});
\`\`\`

> 💡 **팁**: \`setup\`에서 서버 데이터를 받아 클라이언트 상태로 전환합니다.`,

  `## Contract API - 타입 안전한 API

Contract는 **Zod 스키마**로 요청/응답을 정의합니다. 런타임 검증과 OpenAPI 스펙을 자동 생성합니다.

\`\`\`typescript
import { z } from "zod";

const chatContract = Mandu.contract({
  description: "Chat API",
  request: {
    POST: {
      body: z.object({
        message: z.string().min(1).max(2000),
        sessionId: z.string().uuid(),
      }),
    },
  },
  response: {
    200: z.object({ reply: z.string() }),
    400: z.object({ error: z.string() }),
  },
});
\`\`\`

### 장점
- ✅ 컴파일타임 + 런타임 타입 안전
- ✅ OpenAPI 3.0 자동 생성
- ✅ 클라이언트 SDK 자동 생성 가능`,

  `## Slot - 서버사이드 데이터 로딩

Slot은 **페이지 렌더링 전** 서버에서 데이터를 로드하는 패턴입니다.

\`\`\`typescript
// app/page.slot.ts
export default Mandu.filling()
  .loader(async (ctx) => {
    const sessions = chatService.listSessions();
    return { sessions, currentSession: sessions[0] };
  });
\`\`\`

Island에서 이 데이터를 자연스럽게 받아 사용합니다:

\`\`\`typescript
export default island<SlotData>({
  setup: (serverData) => {
    // serverData.sessions 사용 가능
    const [sessions] = useState(serverData.sessions);
    return { sessions };
  },
  render: ({ sessions }) => (
    <ul>
      {sessions.map(s => <li key={s.id}>{s.title}</li>)}
    </ul>
  ),
});
\`\`\``,
];

// ─── Prepared Statements ───────────────────────────────────

const stmts = {
  insertSession: db.prepare(
    "INSERT INTO sessions (id, title, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ),
  getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  listSessions: db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC"),
  updateSessionTitle: db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?"),
  updateSessionPrompt: db.prepare("UPDATE sessions SET system_prompt = ?, updated_at = ? WHERE id = ?"),
  updateSessionTime: db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),

  insertMessage: db.prepare(
    "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)"
  ),
  getMessages: db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC"),
  getMessageCount: db.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?"),
  deleteLastAssistantMsg: db.prepare(
    `DELETE FROM messages WHERE id = (
      SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY timestamp DESC LIMIT 1
    )`
  ),
  searchMessages: db.prepare(
    `SELECT m.*, s.title as session_title FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE m.content LIKE ? ORDER BY m.timestamp DESC LIMIT 50`
  ),
};

// ─── Service ───────────────────────────────────────────────

class ChatService {
  constructor() {
    // Create default session if none exist
    const sessions = stmts.listSessions.all();
    if (sessions.length === 0) {
      const session = this.createSession("새 채팅");
      this.addMessage(session.id, {
        role: "assistant",
        content: "안녕하세요! 👋 Mandu AI Chat 데모입니다.\n\n**Mandu 프레임워크**에 대해 무엇이든 물어보세요. 코드 예시와 함께 설명해드립니다.",
      });
    }
  }

  createSession(title?: string): ChatSession {
    const id = crypto.randomUUID();
    const now = Date.now();
    stmts.insertSession.run(id, title || "새 채팅", DEFAULT_SYSTEM_PROMPT, now, now);
    return {
      id,
      title: title || "새 채팅",
      messages: [],
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(id: string): ChatSession | undefined {
    const row = stmts.getSession.get(id) as any;
    if (!row) return undefined;
    const messages = (stmts.getMessages.all(id) as any[]).map(this.rowToMessage);
    return {
      id: row.id,
      title: row.title,
      messages,
      systemPrompt: row.system_prompt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listSessions(): ChatSession[] {
    return (stmts.listSessions.all() as any[]).map(row => {
      const messages = (stmts.getMessages.all(row.id) as any[]).map(this.rowToMessage);
      return {
        id: row.id,
        title: row.title,
        messages,
        systemPrompt: row.system_prompt,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  addMessage(sessionId: string, message: Omit<Message, "id" | "timestamp">): Message | null {
    const session = stmts.getSession.get(sessionId) as any;
    if (!session) return null;

    const id = crypto.randomUUID();
    const timestamp = Date.now();
    stmts.insertMessage.run(id, sessionId, message.role, message.content, timestamp);
    stmts.updateSessionTime.run(timestamp, sessionId);

    // Auto-title from first user message
    if (message.role === "user") {
      const count = (stmts.getMessageCount.get(sessionId) as any).count;
      if (count <= 3) {
        const title = message.content.slice(0, 30) + (message.content.length > 30 ? "..." : "");
        stmts.updateSessionTitle.run(title, timestamp, sessionId);
      }
    }

    return { id, role: message.role, content: message.content, timestamp };
  }

  deleteLastAssistantMessage(sessionId: string): boolean {
    const result = stmts.deleteLastAssistantMsg.run(sessionId);
    return result.changes > 0;
  }

  updateSystemPrompt(sessionId: string, prompt: string): boolean {
    const result = stmts.updateSessionPrompt.run(prompt, Date.now(), sessionId);
    return result.changes > 0;
  }

  deleteSession(id: string): boolean {
    const result = stmts.deleteSession.run(id);
    return result.changes > 0;
  }

  searchMessages(query: string): Array<{ message: Message; sessionId: string; sessionTitle: string }> {
    const rows = stmts.searchMessages.all(`%${query}%`) as any[];
    return rows.map(row => ({
      message: this.rowToMessage(row),
      sessionId: row.session_id,
      sessionTitle: row.session_title,
    }));
  }

  getRandomResponse(): string {
    return MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
  }

  getResponseChunks(response: string, chunkSize: number = STREAM_CHUNK_SIZE): string[] {
    const chunks: string[] = [];
    let cursor = 0;

    while (cursor < response.length) {
      let next = Math.min(cursor + chunkSize, response.length);

      if (next < response.length) {
        const boundary = Math.max(
          response.lastIndexOf("\n", next - 1),
          response.lastIndexOf(" ", next - 1),
        );

        if (boundary > cursor + Math.floor(chunkSize / 2)) {
          next = boundary + 1;
        }
      }

      chunks.push(response.slice(cursor, next));
      cursor = next;
    }

    return chunks;
  }

  private rowToMessage(row: any): Message {
    return { id: row.id, role: row.role, content: row.content, timestamp: row.timestamp };
  }
}

export const chatService = new ChatService();
