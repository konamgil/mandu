---
title: Deploy to Vercel
impact: MEDIUM
impactDescription: Serverless deployment with edge functions
tags: deployment, vercel, serverless, edge
---

## Deploy to Vercel

**Impact: MEDIUM (Serverless deployment with edge functions)**

Vercel을 사용하여 Mandu 앱을 서버리스로 배포하세요.

**vercel.json 설정:**

```json
{
  "buildCommand": "bun run build",
  "outputDirectory": "dist",
  "framework": null,
  "functions": {
    "api/**/*.ts": {
      "runtime": "nodejs20.x",
      "memory": 1024,
      "maxDuration": 10
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**주의사항:**
Vercel은 Bun 런타임을 직접 지원하지 않으므로, Node.js 호환 모드로 빌드해야 합니다.

**Node.js 호환 빌드:**

```typescript
// scripts/build-vercel.ts
await Bun.build({
  entrypoints: ["./src/server.ts"],
  outdir: "./dist",
  target: "node",  // Node.js 타겟으로 빌드
  minify: true,
  external: ["@vercel/node"],
});
```

## API Routes 변환

```typescript
// api/users/index.ts (Vercel Serverless Function)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHandler } from "@mandujs/vercel";
import usersSlot from "../../app/users/slot";

export default createHandler(usersSlot);
```

**createHandler 구현:**

```typescript
// lib/vercel.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export function createHandler(slot: Slot) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const method = req.method?.toLowerCase() || "get";
    const handler = slot.handlers[method];

    if (!handler) {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const ctx = createContext(req);
    const result = await handler(ctx);

    return res.status(result.status || 200).json(result.body);
  };
}
```

## Edge Functions

```typescript
// api/geo.ts
export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  const geo = request.headers.get("x-vercel-ip-country");

  return new Response(JSON.stringify({ country: geo }), {
    headers: { "Content-Type": "application/json" },
  });
}
```

## 환경 변수

```bash
# Vercel CLI로 환경 변수 설정
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production

# .env.local (로컬 개발)
DATABASE_URL=postgresql://localhost:5432/mandu
SESSION_SECRET=dev-secret
```

## 배포

```bash
# Vercel CLI 설치
npm install -g vercel

# 프로젝트 연결
vercel link

# Preview 배포
vercel

# Production 배포
vercel --prod
```

## 추천 사용 케이스

- 정적 사이트 + API routes
- Edge에서 가벼운 처리가 필요한 경우
- Vercel의 다른 서비스(Analytics, Speed Insights)와 통합

**비추천:**
- 장시간 실행 프로세스 (WebSocket, 스트리밍)
- Bun 특화 기능 필요 시

Reference: [Vercel Documentation](https://vercel.com/docs)
