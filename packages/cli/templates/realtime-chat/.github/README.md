# GitHub Actions CI/CD for Mandu ATE

이 디렉토리는 Mandu ATE (Automation Test Engine) E2E 테스트를 위한 GitHub Actions 워크플로우를 포함합니다.

## 📋 워크플로우 개요

### 1. `ate-e2e.yml` - 전체 E2E 테스트 실행

**트리거:**
- Pull Request (모든 브랜치)
- `main` 브랜치로 Push

**동작:**
1. Bun 환경 설정
2. 의존성 설치
3. Playwright 브라우저 설치 (Chromium)
4. ATE E2E 파이프라인 실행 (`bun run test:e2e:ci`)
5. 테스트 리포트 아티팩트 업로드

**사용 시나리오:**
- 모든 E2E 테스트를 실행하여 전체 앱 동작 검증
- 메인 브랜치 병합 전 안정성 확인

### 2. `ate-e2e-subset.yml` - Impact Analysis 기반 서브셋 테스트

**트리거:**
- Pull Request (opened, synchronize, reopened)

**동작:**
1. **Impact Analysis 단계:**
   - PR의 base와 head 간 변경 파일 분석
   - `scripts/analyze-impact.ts`로 영향받는 테스트 식별
   - 영향 범위가 없으면 테스트 스킵

2. **서브셋 테스트 실행:**
   - 영향받는 테스트만 선택적으로 실행
   - Playwright의 `--grep` 옵션으로 필터링
   - 테스트 결과를 PR 코멘트로 자동 게시

**사용 시나리오:**
- 빠른 피드백 루프 (변경 영향 범위만 테스트)
- CI 실행 시간 최적화
- 리소스 절약

## 🚀 시작하기

### 프로젝트 초기화 시 CI/CD 포함

```bash
bunx mandu init --name my-app --with-ci
```

이 명령은 자동으로 다음을 생성합니다:
- `.github/workflows/ate-e2e.yml`
- `.github/workflows/ate-e2e-subset.yml`
- `scripts/analyze-impact.ts`

### 기존 프로젝트에 추가

1. 이 디렉토리의 워크플로우 파일들을 복사:
   ```bash
   cp -r .github/workflows your-project/.github/workflows
   ```

2. Impact Analysis 스크립트 복사:
   ```bash
   cp scripts/analyze-impact.ts your-project/scripts/
   ```

3. `package.json`에 CI 스크립트 추가:
   ```json
   {
     "scripts": {
       "test:e2e:ci": "bun run test:auto --ci"
     }
   }
   ```

## 📊 Impact Analysis 커스터마이징

`scripts/analyze-impact.ts` 파일의 `IMPACT_MAP`을 수정하여 프로젝트 구조에 맞게 조정할 수 있습니다:

```typescript
const IMPACT_MAP: ImpactMap = {
  // API routes → API 테스트
  "app/api/**": ["**/api*.spec.ts", "**/api*.test.ts"],

  // Client components → UI 테스트
  "src/client/**": ["**/ui*.spec.ts", "**/component*.spec.ts"],

  // 커스텀 매핑 추가
  "src/features/auth/**": ["**/auth*.spec.ts"],
};
```

## 🔍 워크플로우 상태 확인

### GitHub Actions UI
1. Repository → Actions 탭
2. 워크플로우 실행 목록 확인
3. 각 실행 클릭하여 상세 로그 확인

### PR 코멘트
`ate-e2e-subset.yml`는 테스트 결과를 PR에 자동으로 코멘트로 추가합니다:
```
## 🧪 ATE E2E Test Results (Subset)

**Affected tests**: **/ui*.spec.ts|**/component*.spec.ts

✅ Passed: 12
❌ Failed: 0
⏭️ Skipped: 3
```

### 아티팩트 다운로드
테스트 실패 시 다음 아티팩트를 다운로드하여 분석:
- `playwright-report`: HTML 리포트
- `test-results`: 스크린샷, 비디오 등

## 🛠️ 고급 설정

### 환경 변수 설정

GitHub Repository Settings → Secrets and variables → Actions에서 환경 변수 추가:

```yaml
env:
  API_BASE_URL: ${{ secrets.API_BASE_URL }}
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### 다중 브라우저 테스트

`ate-e2e.yml`을 수정하여 여러 브라우저에서 테스트:

```yaml
strategy:
  matrix:
    browser: [chromium, firefox, webkit]
steps:
  - name: Install Playwright browsers
    run: bunx playwright install --with-deps ${{ matrix.browser }}
```

### 병렬 실행

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - name: Run tests
    run: bun run test:e2e:ci --shard=${{ matrix.shard }}/4
```

### Slack 알림 추가

```yaml
- name: Notify Slack
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
    payload: |
      {
        "text": "E2E Tests Failed: ${{ github.event.pull_request.html_url }}"
      }
```

## 📝 트러블슈팅

### 테스트가 스킵되는 경우
- `scripts/analyze-impact.ts`의 IMPACT_MAP 확인
- 변경된 파일이 매핑에 포함되어 있는지 확인
- 로그에서 "Analyzing changes" 출력 확인

### Playwright 브라우저 설치 실패
- `bunx playwright install --with-deps chromium` 직접 실행
- Ubuntu 버전 확인 (ubuntu-latest 사용 권장)

### 아티팩트 업로드 실패
- `.mandu/reports/` 디렉토리 존재 확인
- 테스트 실행이 성공적으로 완료되었는지 확인

## 📚 참고 자료

- [Mandu ATE 문서](../../docs/ATE.md)
- [GitHub Actions 문서](https://docs.github.com/en/actions)
- [Playwright CI 가이드](https://playwright.dev/docs/ci)
