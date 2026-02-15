---
"@mandujs/ate": minor
"@mandujs/mcp": minor
"@mandujs/cli": minor
---

feat(ate): ATE MCP Integration - Production-ready E2E automation

## 🎯 ATE 실전 적용을 위한 MCP 통합 개선

### 신규 MCP 도구 (3개)

#### 1. `mandu.ate.auto_pipeline`
- **전체 파이프라인 자동 실행**: Extract → Generate → Run → Report → Heal
- **Impact Analysis 지원**: subset 테스트 자동 선택
- **유연한 옵션**: Oracle level, CI 모드, auto-heal 커스터마이징
- **진행 상황 가시성**: emoji + 단계별 로그 메시지

#### 2. `mandu.ate.feedback`
- **실패 원인 분석**: selector, timeout, assertion, unknown 분류
- **Heal 제안 우선순위 평가**: 1-10 스케일
- **자동 적용 가능 여부 판단**: selector-map만 안전하게 자동 적용

#### 3. `mandu.ate.apply_heal`
- **안전한 코드 적용**: heal diff를 실제 코드에 적용
- **자동 백업 생성**: 기본값 true, rollback 가능
- **Git working directory 체크**: dirty 상태 검증
- **Invalid healIndex 검증**: 범위 체크 및 note-type 거부

### 핵심 기능 추가

#### packages/ate/src/pipeline.ts (163 lines)
- `runFullPipeline()` 함수 구현
- 5단계 파이프라인 orchestration
- 에러 처리 및 graceful degradation
- 테스트: 4 pass (packages/ate/tests/pipeline.test.ts)

#### packages/ate/src/heal.ts (확장)
- `analyzeFeedback()` 함수 추가
- `applyHeal()` 함수 추가
- 백업/롤백 메커니즘
- 테스트: 7 pass (packages/ate/tests/heal-integration.test.ts)

#### packages/ate/src/reporter/ (HTML 리포트)
- `html.ts`: generateHtmlReport() 구현
- `html-template.ts`: 반응형 HTML 템플릿
- 테스트 결과 시각화 대시보드
- 스크린샷 갤러리, trace 링크
- Tailwind CSS 기반 디자인

### CI/CD 통합

#### GitHub Actions 템플릿 (2개)
- `ate-e2e.yml`: 전체 E2E 테스트
- `ate-e2e-subset.yml`: Impact analysis 기반 subset 테스트
- PR/Push 자동 실행
- Playwright 리포트 artifact 저장

#### CLI 템플릿 통합
- `mandu init` 시 `.github/workflows/` 자동 생성
- 2개 프로젝트 템플릿에 적용 (default, realtime-chat)
- 스크립트 템플릿 추가 (scripts/ate-*.sh)

### 종합 문서화

#### packages/ate/docs/ (2,652 lines)
- `mcp-integration.md` (1,326 lines 영문)
- `mcp-integration.ko.md` (1,326 lines 한글)
- **12개 실행 가능한 예제**:
  - 4개 워크플로우 (기본, subset, 다중 oracle, 자동 복구)
  - 4개 실전 사용 사례 (이커머스, 블로그, 대시보드, 멀티 테넌트)
  - 4개 추가 예제 (CI/CD, 트러블슈팅)
- **5개 Mermaid 다이어그램**:
  - 전체 파이프라인 플로우
  - Impact 분석 기반 Subset 테스팅
  - 다중 Oracle 검증
  - 자동 복구 워크플로우
  - MCP 워크플로우

#### packages/mcp/README.md (업데이트)
- ATE 도구 섹션 추가 (9개 도구)
- 워크플로우 다이어그램 (Mermaid)
- 전체 파이프라인 예제
- 5가지 사용 사례 요약

### 테스트 통계

```
✅ 206 pass (+11 신규)
❌ 0 fail
📝 546 expect() calls (+43)
🗂️  15 테스트 파일 (+2)
```

**신규 테스트 파일**:
- `packages/ate/tests/pipeline.test.ts` (4 tests)
- `packages/ate/tests/heal-integration.test.ts` (7 tests)
- `packages/ate/src/reporter/html.test.ts` (포함)

### 주요 개선 사항

1. **완전 자동화**: 한 번의 MCP 호출로 전체 E2E 파이프라인 실행
2. **자동 복구**: 테스트 실패 시 안전하게 heal 제안 생성 및 적용
3. **CI/CD Ready**: GitHub Actions 즉시 사용 가능
4. **시각화**: HTML 대시보드로 결과 확인
5. **Production 품질**: 백업, 롤백, 에러 처리 완비

### Breaking Changes

None - 모든 기존 API 유지

### Migration Guide

신규 도구 사용 시작:
```typescript
// 전체 파이프라인 자동 실행
await runFullPipeline({
  repoRoot: "/path/to/project",
  baseURL: "http://localhost:3333",
  oracleLevel: "L1",
  ci: false,
  useImpactAnalysis: true,
  base: "main",
  head: "HEAD",
  autoHeal: true
});

// 피드백 분석 + 자동 적용
const feedback = analyzeFeedback({
  repoRoot: "/path/to/project",
  runId: "test-run-123",
  autoApply: false
});

const result = applyHeal({
  repoRoot: "/path/to/project",
  runId: "test-run-123",
  healIndex: 0,
  createBackup: true
});
```

CI/CD 설정:
```bash
# mandu init 시 자동 생성됨
.github/workflows/ate-e2e.yml
.github/workflows/ate-e2e-subset.yml
```

### Credits

Developed by ate-mcp-integration team:
- automation-architect: Pipeline orchestration
- heal-integration-expert: Feedback loop & heal application
- reporting-engineer: HTML reporter
- ci-integration-specialist: GitHub Actions templates
- documentation-lead: Comprehensive docs (2,652 lines)
