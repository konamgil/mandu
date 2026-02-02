---
title: Deploy to Fly.io
impact: MEDIUM
impactDescription: Edge deployment for global performance
tags: deployment, fly, edge, platform
---

## Deploy to Fly.io

**Impact: MEDIUM (Edge deployment for global performance)**

Fly.io를 사용하여 전 세계 엣지에서 Mandu 앱을 실행하세요.

**fly.toml 설정:**

```toml
app = "mandu-app"
primary_region = "nrt"  # Tokyo

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  BUN_ENV = "production"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

  [http_service.concurrency]
    type = "requests"
    hard_limit = 250
    soft_limit = 200

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

**Dockerfile:**

```dockerfile
FROM oven/bun:1.0-slim as builder

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Production image
FROM oven/bun:1.0-slim

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

EXPOSE 3000
USER bun

CMD ["bun", "run", "start"]
```

## 배포 명령어

```bash
# Fly CLI 설치
curl -L https://fly.io/install.sh | sh

# 로그인
fly auth login

# 앱 생성
fly launch --name mandu-app --region nrt

# 배포
fly deploy

# 스케일링
fly scale count 2 --region nrt,sin

# 로그 확인
fly logs
```

## 멀티 리전 배포

```toml
# fly.toml
app = "mandu-app"
primary_region = "nrt"

# 여러 리전에 배포
[processes]
  app = "bun run start"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512

# 리전별 스케일링
# fly scale count app=2 --region nrt
# fly scale count app=1 --region sin
```

## Secrets 관리

```bash
# Secret 설정
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set SESSION_SECRET="..."

# Secret 목록
fly secrets list

# Secret 삭제
fly secrets unset OLD_SECRET
```

## 볼륨 (Persistent Storage)

```bash
# 볼륨 생성
fly volumes create mandu_data --region nrt --size 1

# fly.toml에 마운트
[mounts]
  source = "mandu_data"
  destination = "/data"
```

## 헬스체크

```toml
# fly.toml
[[services.http_checks]]
  interval = "10s"
  timeout = "2s"
  grace_period = "5s"
  method = "GET"
  path = "/health"
```

Reference: [Fly.io Documentation](https://fly.io/docs/)
