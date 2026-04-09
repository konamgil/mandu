import { Mandu } from "@mandujs/core";

const MOCK_RESPONSES = [
  "Mandu는 Bun 기반의 풀스택 프레임워크입니다. Island 아키텍처로 필요한 부분만 하이드레이션하여 성능을 최적화합니다.",
  "SSE(Server-Sent Events)는 서버에서 클라이언트로 실시간 데이터를 스트리밍하는 기술입니다. WebSocket보다 간단하고 HTTP 위에서 동작합니다.",
  "Filling API는 Mandu의 핵심 핸들러 체이닝 시스템입니다. `.get()`, `.post()` 등으로 HTTP 메서드별 핸들러를 정의하고 미들웨어를 조합할 수 있습니다.",
  "Island 컴포넌트는 `Mandu.island()` 로 정의합니다. setup 함수에서 상태를 초기화하고, render 함수에서 UI를 그립니다. 서버 데이터를 자연스럽게 클라이언트 상태로 전환합니다.",
  "Contract API로 요청/응답 스키마를 Zod로 정의하면 타입 안전한 API를 구축할 수 있습니다. OpenAPI 스펙도 자동 생성됩니다.",
];

export default Mandu.filling()
  .post(async (ctx) => {
    const { message } = await ctx.body<{ message: string }>();

    if (!message?.trim()) {
      return ctx.error("Message is required");
    }

    const response = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
    const words = response.split("");

    const sse = Mandu.sse(ctx.request.signal);
    const stopHeartbeat = sse.heartbeat(10000);

    (async () => {
      try {
        for (const char of words) {
          await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
          sse.send({ token: char }, { event: "token" });
        }
        sse.send({ done: true }, { event: "done" });
      } finally {
        stopHeartbeat();
        await sse.close();
      }
    })();

    return sse.response;
  });
