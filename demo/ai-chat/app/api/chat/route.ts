/**
 * Chat API - Intent 기반 API 데모
 */
import { Mandu } from '@mandujs/core';
import { z } from 'zod';

const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })),
});

// AI 응답 시뮬레이션
async function* generateAIResponse(messages: { role: string; content: string }[]) {
  const lastMessage = messages[messages.length - 1]?.content || '';

  const responses: Record<string, string> = {
    '안녕': '안녕하세요! 저는 Mandu AI 어시스턴트입니다. 무엇을 도와드릴까요? 🥟',
    'hello': 'Hello! I am Mandu AI Assistant. How can I help you today? 🥟',
    'mandu': 'Mandu는 AI-Native 웹 프레임워크입니다!\n\n주요 특징:\n- 🏝️ 선언적 Islands (island() API)\n- 📝 Intent 기반 API (intent() API)\n- 📋 Contract-First 개발\n- 🛡️ Guard 아키텍처 검증\n- 🤖 MCP AI 통합',
    '프레임워크': 'Mandu Framework의 혁신:\n\n1. **island("visible", Component)**: 한 줄로 Islands 선언\n2. **intent({ "의도": handler })**: 의도 기반 API\n3. **defineContract()**: Contract에서 전체 스택 생성\n4. **AI-Native**: AI가 이해하기 쉬운 구조',
    'island': 'Mandu Island API:\n\n```tsx\nimport { Mandu } from "@mandujs/core";\n\nexport default Mandu.island("visible", ({ name }) => {\n  const [count, setCount] = useState(0);\n  return <button>{name}: {count}</button>;\n});\n```\n\n하이드레이션 전략: load | idle | visible | media | never',
    'intent': 'Mandu Intent API:\n\n```ts\nexport default Mandu.intent({\n  "사용자 조회": {\n    method: "GET",\n    handler: (ctx) => ctx.ok(user),\n  },\n  "사용자 생성": {\n    method: "POST",\n    input: userSchema,\n    handler: async (ctx) => {\n      const data = await ctx.body();\n      return ctx.created(newUser);\n    },\n  },\n});\n```',
  };

  let response = '흥미로운 질문이네요! Mandu는 "AI가 이해하기 쉬운 프레임워크"를 목표로 합니다.\n\n키워드를 입력해보세요: mandu, island, intent, 프레임워크';

  for (const [keyword, resp] of Object.entries(responses)) {
    if (lastMessage.toLowerCase().includes(keyword.toLowerCase())) {
      response = resp;
      break;
    }
  }

  const words = response.split(' ');
  for (let i = 0; i < words.length; i++) {
    yield words[i] + (i < words.length - 1 ? ' ' : '');
    await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
  }
}

// Intent 기반 API 정의
export default Mandu.filling()
  .post(async (ctx) => {
    let messages;
    try {
      const body = await ctx.body(ChatRequestSchema);
      messages = body.messages;
    } catch (error) {
      console.error('Body validation error:', error);
      return ctx.error('Invalid request body');
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of generateAIResponse(messages)) {
            const data = JSON.stringify({ content: chunk, done: false });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });
