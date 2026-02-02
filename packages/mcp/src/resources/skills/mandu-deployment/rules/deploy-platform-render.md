---
title: Deploy to Render
impact: HIGH
impactDescription: Managed platform for production workloads
tags: deployment, render, platform, hosting
---

## Deploy to Render

**Impact: HIGH (Managed platform for production workloads)**

Render를 사용하여 Mandu 앱을 배포하세요. 자동 HTTPS, 스케일링, 무중단 배포를 지원합니다.

**render.yaml (Blueprint):**

```yaml
services:
  - type: web
    name: mandu-app
    runtime: node
    region: singapore  # 또는 oregon, frankfurt 등
    plan: starter      # starter, standard, pro

    buildCommand: |
      curl -fsSL https://bun.sh/install | bash
      export PATH="$HOME/.bun/bin:$PATH"
      bun install --frozen-lockfile
      bun run build

    startCommand: |
      export PATH="$HOME/.bun/bin:$PATH"
      bun run start

    healthCheckPath: /health

    envVars:
      - key: NODE_ENV
        value: production
      - key: BUN_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: mandu-db
          property: connectionString
      - key: SESSION_SECRET
        generateValue: true

databases:
  - name: mandu-db
    plan: starter
    databaseName: mandu
    user: mandu
```

## 헬스체크 엔드포인트

```typescript
// app/health/slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling({
  get: async (ctx) => {
    // 데이터베이스 연결 확인
    try {
      await db.query("SELECT 1");
      return ctx.ok({ status: "healthy", timestamp: new Date().toISOString() });
    } catch (error) {
      return ctx.fail("Database connection failed");
    }
  },
});
```

## Render Native Runtime (Bun 직접 지원)

```yaml
# render.yaml - Bun 네이티브 (Beta)
services:
  - type: web
    name: mandu-app
    runtime: docker
    dockerfilePath: ./Dockerfile

    envVars:
      - key: NODE_ENV
        value: production
```

```dockerfile
# Dockerfile
FROM oven/bun:1.0-slim

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY . .
RUN bun run build

EXPOSE 3000
USER bun

CMD ["bun", "run", "start"]
```

## 환경별 배포

```yaml
# render.yaml - Preview Environments
previewsEnabled: true
previewsExpireAfterDays: 7

services:
  - type: web
    name: mandu-app
    # ... 기본 설정

    envVars:
      - key: NODE_ENV
        value: production
      - key: API_URL
        fromGroup: mandu-production  # Production

    previews:
      generation: automatic
      envVars:
        - key: API_URL
          fromGroup: mandu-staging   # Preview는 staging 사용
```

## 자동 배포 설정

```yaml
# GitHub 연동 시 자동 배포
# render.yaml
services:
  - type: web
    name: mandu-app
    repo: https://github.com/your-org/mandu-app
    branch: main                    # main 브랜치 자동 배포
    autoDeploy: true               # push 시 자동 배포
```

## 스케일링 설정

```yaml
services:
  - type: web
    name: mandu-app
    plan: standard

    scaling:
      minInstances: 1
      maxInstances: 5
      targetMemoryPercent: 80
      targetCPUPercent: 70
```

## Render CLI

```bash
# CLI 설치
npm install -g @render/cli

# 로그인
render login

# 서비스 목록
render services list

# 수동 배포
render deploys create --service-id srv-xxx

# 로그 확인
render logs --service-id srv-xxx --tail
```

Reference: [Render Documentation](https://render.com/docs)
