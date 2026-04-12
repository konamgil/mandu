# GitHub Actions CI/CD Integration for Mandu

> Mandu 프로젝트에 GitHub Actions 기반 CI/CD 파이프라인을 통합하는 가이드

## 목차

1. [개요](#개요)
2. [빠른 시작](#빠른-시작)
3. [워크플로우 상세](#워크플로우-상세)
4. [Impact Analysis](#impact-analysis)
5. [커스터마이징](#커스터마이징)
6. [배포](#배포)
7. [트러블슈팅](#트러블슈팅)

## 개요

Mandu는 GitHub Actions와 통합하여 빌드, 검증, 테스트, 배포를 포함한 자동화된 CI/CD 파이프라인을 제공합니다.

### 주요 기능

- **빌드 파이프라인**: 클라이언트 번들 + CSS + 프리렌더링(SSG) 통합 빌드
- **Guard 검증**: 구조 규칙, 슬롯 무결성, 계약(contract) 유효성 자동 검사
- **ATE 테스트**: Automation Test Engine 기반 E2E 및 서브셋 테스트
- **Impact Analysis**: 변경된 파일 기반 서브셋 테스트로 실행 시간 최적화
- **자동 리포트**: PR에 테스트 결과 자동 코멘트
- **병렬 실행**: 다중 브라우저, Shard 기반 병렬화 지원
- **Docker 배포**: `mandu deploy --target docker` 내장 배포 지원

## 빠른 시작

### 1. 새 프로젝트 생성 (CI/CD 포함)

```bash
bunx mandu init --name my-app --with-ci
```

이 명령은 자동으로 다음을 생성합니다:

```
my-app/
├── .github/
│   ├── workflows/
│   │   ├── ate-e2e.yml              # 전체 E2E 테스트
│   │   └── ate-e2e-subset.yml       # Impact Analysis 기반 서브셋
│   └── README.md                     # CI/CD 사용 가이드
├── scripts/
│   └── analyze-impact.ts             # Impact Analysis 로직
└── package.json
```

### 2. GitHub Repository 설정

```bash
cd my-app
git init
git add .
git commit -m "Initial commit with CI/CD"
git remote add origin https://github.com/username/my-app.git
git push -u origin main
```

### 3. PR 생성하여 테스트

```bash
git checkout -b feature/my-feature
# 코드 수정...
git add .
git commit -m "Add new feature"
git push origin feature/my-feature
# GitHub에서 PR 생성
```

PR이 생성되면 자동으로 워크플로우가 실행됩니다.

## 워크플로우 상세

### `ate-e2e.yml` - 전체 E2E 테스트

**트리거:**
- Pull Request (모든 브랜치)
- `main` 브랜치로 Push

**실행 단계:**

```yaml
1. Checkout code                    # 코드 체크아웃
2. Setup Bun                        # Bun 런타임 설치
3. Install dependencies             # 의존성 설치
4. Guard check                      # bun run mandu guard-check
5. Contract validation              # bun run mandu contract validate
6. Build                            # bun run mandu build
7. Install Playwright               # Playwright 브라우저 설치
8. Run ATE tests                    # bun run mandu test:auto
9. Upload artifacts                 # 리포트 업로드
```

**사용 시나리오:**
- 메인 브랜치 병합 전 전체 검증
- 주요 릴리스 전 안정성 확인
- Nightly 빌드

### `ate-e2e-subset.yml` - Impact Analysis 기반 서브셋

**트리거:**
- Pull Request (opened, synchronize, reopened)

**실행 단계:**

```yaml
Job 1: analyze-changes
  1. Checkout with full history    # Git 히스토리 포함 체크아웃
  2. Setup Bun
  3. Install dependencies
  4. Guard check                    # bun run mandu guard-check
  5. Analyze impact                 # 변경 파일 분석
  6. Determine affected tests       # 영향받는 테스트 식별

Job 2: e2e-subset (conditional)
  1. Checkout code
  2. Setup Bun
  3. Install dependencies
  4. Build                          # bun run mandu build
  5. Install Playwright
  6. Run affected tests only        # bun run mandu test:auto (서브셋)
  7. Upload artifacts
  8. Comment PR with results        # PR에 결과 코멘트
```

**사용 시나리오:**
- 빠른 피드백 루프 (변경 영향 범위만 테스트)
- CI 실행 시간 최적화
- 리소스 절약

## Impact Analysis

### 작동 원리

1. **변경 파일 탐지**
   ```bash
   git diff --name-only $BASE_SHA $HEAD_SHA
   ```

2. **패턴 매칭**
   `scripts/analyze-impact.ts`의 `IMPACT_MAP`을 사용하여 영향받는 테스트 식별

3. **테스트 필터링**
   Playwright의 `--grep` 옵션으로 서브셋만 실행

### IMPACT_MAP 구조

```typescript
const IMPACT_MAP: ImpactMap = {
  // 파일 패턴 : 테스트 패턴
  "app/api/**": ["**/api*.spec.ts", "**/api*.test.ts"],
  "src/client/**": ["**/ui*.spec.ts", "**/component*.spec.ts"],
  "src/server/**": ["**/integration*.spec.ts", "**/server*.spec.ts"],
  "src/shared/contracts/**": ["**/integration*.spec.ts", "**/e2e*.spec.ts"],
};
```

### 커스터마이징 예시

**프로젝트 특성에 맞게 수정:**

```typescript
const IMPACT_MAP: ImpactMap = {
  // 인증 관련 변경 → 인증 테스트
  "src/features/auth/**": [
    "**/auth*.spec.ts",
    "**/login*.spec.ts",
    "**/signup*.spec.ts"
  ],

  // 결제 관련 변경 → 결제 통합 테스트
  "src/features/payment/**": [
    "**/payment*.spec.ts",
    "**/checkout*.spec.ts"
  ],

  // 데이터베이스 스키마 변경 → 모든 통합 테스트
  "prisma/schema.prisma": ["**/integration*.spec.ts"],

  // 환경 설정 변경 → 모든 테스트
  ".env.example": ["**/*.spec.ts"],
};
```

## 커스터마이징

### 1. 환경 변수 설정

GitHub Repository Settings → Secrets and variables → Actions:

```yaml
# .github/workflows/ate-e2e.yml
env:
  API_BASE_URL: ${{ secrets.API_BASE_URL }}
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
```

### 2. 다중 브라우저 테스트

```yaml
# .github/workflows/ate-e2e.yml
strategy:
  matrix:
    browser: [chromium, firefox, webkit]

steps:
  - name: Install Playwright browsers
    run: bunx playwright install --with-deps ${{ matrix.browser }}

  - name: Run tests
    run: bun run mandu test:auto --ci
    env:
      BROWSER: ${{ matrix.browser }}
```

### 3. 병렬 실행 (Sharding)

```yaml
# .github/workflows/ate-e2e.yml
strategy:
  matrix:
    shard: [1, 2, 3, 4]

steps:
  - name: Run tests
    run: bun run mandu test:auto --ci --shard=${{ matrix.shard }}/4
```

### 4. Slack 알림 추가

```yaml
# .github/workflows/ate-e2e.yml
- name: Notify Slack on failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
    payload: |
      {
        "text": "🚨 E2E Tests Failed",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "E2E tests failed on PR: ${{ github.event.pull_request.html_url }}"
            }
          }
        ]
      }
```

### 5. 스케줄 실행 (Nightly)

```yaml
# .github/workflows/ate-e2e-nightly.yml
name: Nightly E2E Tests

on:
  schedule:
    - cron: '0 2 * * *'  # 매일 02:00 UTC

jobs:
  e2e:
    # ... (ate-e2e.yml과 동일)
```

## 트러블슈팅

### 문제 1: 테스트가 스킵되는 경우

**증상:**
```
analyze-changes job 완료
e2e-subset job 스킵됨
```

**해결 방법:**
1. `scripts/analyze-impact.ts`의 `IMPACT_MAP` 확인
2. 변경된 파일이 매핑에 포함되어 있는지 검증
3. GitHub Actions 로그에서 "Analyzing changes" 출력 확인

```bash
# 로컬에서 테스트
echo "app/api/users/route.ts" > changed-files.txt
bun run scripts/analyze-impact.ts changed-files.txt
```

### 문제 2: Playwright 브라우저 설치 실패

**증상:**
```
Error: browserType.launch: Executable doesn't exist
```

**해결 방법:**
```yaml
# 올바른 설치 명령 사용
- name: Install Playwright browsers
  run: bunx playwright install --with-deps chromium
```

**참고:**
- Ubuntu 버전 확인 (`ubuntu-latest` 권장)
- 특정 브라우저만 설치하여 시간 절약

### 문제 3: 아티팩트 업로드 실패

**증상:**
```
Error: Unable to find any artifacts for the associated workflow
```

**해결 방법:**
1. `.mandu/reports/` 디렉토리 존재 확인
2. 테스트 실행이 성공적으로 완료되었는지 확인
3. `package.json`의 `test:e2e:ci` 스크립트 확인

```json
{
  "scripts": {
    "test:e2e:ci": "bun run mandu test:auto --ci"
  }
}
```

### 문제 4: PR 코멘트가 추가되지 않음

**증상:**
PR에 테스트 결과 코멘트가 나타나지 않음

**해결 방법:**
1. GitHub Actions 권한 확인
   - Repository Settings → Actions → General
   - "Workflow permissions" → "Read and write permissions" 활성화

2. 코멘트 생성 스크립트 확인:
```yaml
- name: Comment PR with test results
  if: always()
  uses: actions/github-script@v7
  # ...
```

### 문제 5: 타임아웃 발생

**증상:**
```
Error: The job running on runner GitHub Actions X has exceeded the maximum execution time of 360 minutes.
```

**해결 방법:**
```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30  # 적절한 시간 설정
```

또는 병렬화:
```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
```

## 배포

### Docker 배포 (내장)

Mandu는 Docker 배포를 내장 지원합니다.

**로컬에서 Docker 이미지 빌드 및 배포:**

```bash
bun run mandu deploy --target docker
```

이 명령은 다음을 수행합니다:
1. 프로덕션 빌드 (`bun run mandu build`) 실행
2. 최적화된 Dockerfile 자동 생성
3. Docker 이미지 빌드

**CI에서 Docker 배포:**

```yaml
- name: Build application
  run: bun run mandu build

- name: Deploy to Docker
  run: bun run mandu deploy --target docker
  env:
    DOCKER_REGISTRY: ${{ secrets.DOCKER_REGISTRY }}
```

### 빌드 명령어 요약

| 명령어 | 설명 |
|--------|------|
| `bun run mandu build` | 클라이언트 번들 + CSS + 프리렌더링(SSG) 통합 빌드 |
| `bun run mandu guard-check` | Guard 규칙 검증 (구조, 슬롯, island 무결성) |
| `bun run mandu contract validate` | Contract(Zod 스키마) 유효성 검사 |
| `bun run mandu test:auto` | ATE 자동화 테스트 실행 |
| `bun run mandu deploy --target docker` | Docker 이미지 빌드 및 배포 |

## 고급 기능

### 1. 조건부 워크플로우 실행

```yaml
# .github/workflows/ate-e2e.yml
on:
  pull_request:
    paths:
      - 'src/**'
      - 'tests/**'
      - 'package.json'
```

### 2. 워크플로우 재사용

```yaml
# .github/workflows/reusable-e2e.yml
name: Reusable E2E Workflow

on:
  workflow_call:
    inputs:
      browser:
        required: true
        type: string
```

```yaml
# .github/workflows/test-chrome.yml
jobs:
  test:
    uses: ./.github/workflows/reusable-e2e.yml
    with:
      browser: chromium
```

### 3. 수동 워크플로우 실행

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to test'
        required: true
        type: choice
        options:
          - staging
          - production
```

## 성능 최적화

### 1. 캐싱 활용

```yaml
- name: Cache Bun dependencies
  uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb') }}
    restore-keys: |
      ${{ runner.os }}-bun-
```

### 2. 조건부 단계 실행

```yaml
- name: Run integration tests
  if: contains(github.event.pull_request.labels.*.name, 'run-integration')
  run: bun run mandu test:auto --ci
```

### 3. 동시 실행 제어

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

## 베스트 프랙티스

1. **테스트 격리**: 각 테스트는 독립적으로 실행 가능해야 함
2. **빠른 피드백**: Impact Analysis로 변경 관련 테스트만 실행
3. **명확한 실패 메시지**: 테스트 실패 시 원인 파악이 쉽도록
4. **아티팩트 관리**: 필요한 아티팩트만 업로드하여 스토리지 절약
5. **보안**: 민감 정보는 GitHub Secrets 사용

## 참고 자료

- [Mandu ATE 문서](./ATE.md)
- [GitHub Actions 문서](https://docs.github.com/en/actions)
- [Playwright CI 가이드](https://playwright.dev/docs/ci)
- [Bun 문서](https://bun.sh/docs)
