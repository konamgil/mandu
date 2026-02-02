---
title: Docker with Bun
impact: HIGH
impactDescription: Ensures consistent deployment environment
tags: deployment, docker, bun, container
---

## Docker with Bun

**Impact: HIGH (Ensures consistent deployment environment)**

Docker를 사용하여 Bun 기반 Mandu 앱을 컨테이너화하세요.

**Dockerfile (Production):**

```dockerfile
# Build stage
FROM oven/bun:1.0 as builder

WORKDIR /app

# 의존성 설치 (캐시 활용)
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# 소스 복사 및 빌드
COPY . .
RUN bun run build

# 프로덕션 의존성만 설치
RUN bun install --frozen-lockfile --production

# Production stage
FROM oven/bun:1.0-slim

WORKDIR /app

# 빌드 결과물만 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 보안: non-root 사용자
USER bun

EXPOSE 3000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "start"]
```

## .dockerignore

```
node_modules
dist
.git
.gitignore
*.md
*.log
.env*
!.env.example
tests
coverage
.github
```

## 멀티스테이지 빌드 최적화

```dockerfile
# Alpine 기반 (더 작은 이미지)
FROM oven/bun:1.0-alpine as builder
# ... 빌드 과정

FROM oven/bun:1.0-alpine
# ... 프로덕션 설정

# distroless 기반 (최소 공격면)
FROM gcr.io/distroless/cc
COPY --from=builder /app/dist /app/dist
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun
CMD ["/usr/local/bin/bun", "run", "/app/dist/server.js"]
```

## 빌드 및 실행

```bash
# 이미지 빌드
docker build -t mandu-app:latest .

# 빌드 캐시 활용
docker build --cache-from mandu-app:latest -t mandu-app:latest .

# 컨테이너 실행
docker run -d \
  --name mandu \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e SESSION_SECRET="..." \
  mandu-app:latest

# 로그 확인
docker logs -f mandu

# 컨테이너 접속
docker exec -it mandu sh
```

## 개발용 Dockerfile

```dockerfile
# Dockerfile.dev
FROM oven/bun:1.0

WORKDIR /app

# Hot reload를 위한 볼륨 마운트용
COPY package.json bun.lockb ./
RUN bun install

EXPOSE 3000

CMD ["bun", "run", "dev"]
```

```bash
# 개발 모드 실행
docker build -f Dockerfile.dev -t mandu-dev .
docker run -v $(pwd):/app -p 3000:3000 mandu-dev
```

## 이미지 크기 최적화

```bash
# 이미지 크기 확인
docker images mandu-app

# 레이어 분석
docker history mandu-app:latest

# 최적화 목표
# - oven/bun:1.0-slim: ~150MB base
# - 프로덕션 deps만: 추가 50-100MB
# - 총 목표: < 300MB
```

Reference: [Bun Docker Images](https://hub.docker.com/r/oven/bun)
