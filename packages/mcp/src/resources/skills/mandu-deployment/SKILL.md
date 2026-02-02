---
name: Mandu Deployment
description: Production deployment patterns for Mandu applications
metadata:
  version: "1.0.0"
  author: mandu
globs:
  - "render.yaml"
  - "Dockerfile"
  - "docker-compose.yml"
  - ".github/workflows/*.yml"
  - "bunfig.toml"
---

# Mandu Deployment Skill

Mandu 앱을 프로덕션 환경에 안전하고 효율적으로 배포하기 위한 가이드입니다.

## 핵심 원칙

1. **Bun 네이티브**: Bun 런타임과 번들러를 최대한 활용
2. **환경 분리**: 개발/스테이징/프로덕션 환경 명확히 구분
3. **자동화**: CI/CD를 통한 일관된 배포 프로세스
4. **보안 우선**: 민감 정보는 환경 변수로 관리

## 빠른 시작

### Render 배포 (권장)

```yaml
# render.yaml
services:
  - type: web
    name: mandu-app
    runtime: node
    buildCommand: bun install && bun run build
    startCommand: bun run start
    envVars:
      - key: NODE_ENV
        value: production
      - key: BUN_ENV
        value: production
```

### Docker 배포

```dockerfile
FROM oven/bun:1.0

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY . .
RUN bun run build

EXPOSE 3000
CMD ["bun", "run", "start"]
```

## 배포 체크리스트

### 빌드 준비
- [ ] `bun run build` 성공 확인
- [ ] 번들 크기 최적화 (tree-shaking, code-splitting)
- [ ] 환경 변수 설정 완료

### 플랫폼 설정
- [ ] Render/Docker 설정 파일 작성
- [ ] 헬스체크 엔드포인트 구현
- [ ] 로깅 설정 완료

### 보안
- [ ] 민감 정보 환경 변수로 분리
- [ ] HTTPS 강제 적용
- [ ] 보안 헤더 설정

### 모니터링
- [ ] 에러 트래킹 설정
- [ ] 성능 모니터링 구성
- [ ] 알림 설정

## 규칙 카테고리

| Category | Description | Rules |
|----------|-------------|-------|
| Build | 프로덕션 빌드 최적화 | 2 |
| Platform | 플랫폼별 배포 설정 | 3 |
| Container | Docker 컨테이너화 | 2 |
| CI/CD | 자동화 파이프라인 | 1 |

→ 세부 규칙은 `rules/` 폴더 참조
