---
title: Docker Compose Setup
impact: MEDIUM
impactDescription: Orchestrates multi-container development and deployment
tags: deployment, docker, compose, orchestration
---

## Docker Compose Setup

**Impact: MEDIUM (Orchestrates multi-container development and deployment)**

Docker Compose를 사용하여 Mandu 앱과 관련 서비스를 함께 관리하세요.

**docker-compose.yml (Production):**

```yaml
version: "3.8"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/mandu
      - REDIS_URL=redis://cache:6379
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=mandu
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  cache:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  postgres_data:
  redis_data:
```

## 개발용 Compose

```yaml
# docker-compose.dev.yml
version: "3.8"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    volumes:
      - .:/app
      - /app/node_modules  # node_modules 제외
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:devpass@db:5432/mandu_dev
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=devpass
      - POSTGRES_DB=mandu_dev
    ports:
      - "5432:5432"
    volumes:
      - dev_postgres:/var/lib/postgresql/data

volumes:
  dev_postgres:
```

## 환경별 오버라이드

```yaml
# docker-compose.override.yml (로컬 개발 자동 적용)
version: "3.8"

services:
  app:
    volumes:
      - .:/app
    environment:
      - DEBUG=true
```

```yaml
# docker-compose.staging.yml
version: "3.8"

services:
  app:
    image: ghcr.io/your-org/mandu-app:staging
    environment:
      - NODE_ENV=staging
```

## 명령어

```bash
# 개발 환경 시작
docker compose -f docker-compose.dev.yml up -d

# 프로덕션 빌드 및 시작
docker compose up -d --build

# 스케일링
docker compose up -d --scale app=3

# 로그 확인
docker compose logs -f app

# 서비스 상태
docker compose ps

# 정리
docker compose down -v  # 볼륨 포함 삭제
```

## 네트워크 구성

```yaml
services:
  app:
    networks:
      - frontend
      - backend

  db:
    networks:
      - backend

  nginx:
    networks:
      - frontend
    ports:
      - "80:80"
      - "443:443"

networks:
  frontend:
  backend:
    internal: true  # 외부 접근 차단
```

## 리버스 프록시 (Nginx)

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app
```

```nginx
# nginx.conf
upstream mandu_app {
    server app:3000;
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        proxy_pass http://mandu_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Reference: [Docker Compose Documentation](https://docs.docker.com/compose/)
