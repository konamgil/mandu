# Mandu 문서 인덱스

이 문서 인덱스는 문서를 세 가지 상태로 구분합니다.

| 상태 | 의미 | 사용 원칙 |
|------|------|-----------|
| `official` | 현재 Mandu 공식 워크플로와 맞는 문서 | 온보딩과 실사용 기준으로 바로 사용 가능 |
| `draft` | 작성 중이거나, 결정이 아직 고정되지 않았거나, TODO가 남아 있는 문서 | 해당 영역을 의도적으로 탐색할 때만 참고 |
| `legacy` | 과거 설계, 이전 워크플로, 기록성 문서 | 첫 진입 문서로 사용하지 않음 |

처음 Mandu를 보는 경우에는 앱이 뜰 때까지 `official` 영역만 따라가는 것을 권장합니다.

---

## 먼저 읽을 문서

1. `docs/guides/01_configuration.ko.md` - 현재 설정 방식, 런타임 기본값, dev/build 동작
2. `docs/api/api-reference.ko.md` - 현재 공개 API 레퍼런스
3. `docs/status.ko.md` - 코드 기준 구현 상태 매트릭스
4. `docs/plans/14_top_tier_framework_priority_plan.md` - 현재 우선순위 실행 계획

---

## Official

- `docs/guides/01_configuration.ko.md` - 공식 설정 가이드
- `docs/api/api-reference.ko.md` - 공식 API 레퍼런스
- `docs/status.ko.md` - 현재 구현 상태
- `docs/product/01_mandu_product_brief.md` - 제품 방향성
- `docs/architecture/02_mandu_technical_architecture.md` - 현재 기술 아키텍처 개요
- `docs/architecture/05_mandu_backend-architecture-guardrails.md` - 백엔드 가드레일
- `docs/specs/05_fs_routes_system.md` - FS Routes 기준 문서
- `docs/specs/06_mandu_guard.md` - Guard 기준 문서
- `docs/specs/07_seo_module.md` - SEO 모듈 기준 문서
- `docs/specs/08_runtime_status_code_policy.md` - 런타임 HTTP 상태 코드 정책
- `docs/guides/04_prisma.md` - 공식 Prisma 연동 가이드
- `docs/guides/05_realtime_chat_starter.md` - 공식 realtime starter 가이드
- `demo/README.md` - 공식 demo 인덱스와 현재 demo 상태
- `docs/plans/14_top_tier_framework_priority_plan.md` - 현재 top-tier 실행 로드맵

## Draft

- `docs/comparison/manifest-vs-resource.md` - legacy manifest 흐름과 resource 흐름 비교 초안
- `docs/guides/resource-workflow.md` - 기본 온보딩 경로가 아닌 resource add-on 워크플로 초안
- `docs/guides/resource-troubleshooting.md` - resource 워크플로 트러블슈팅 초안
- `docs/migration/to-resources.md` - manifest -> resource 마이그레이션 초안
- `docs/guides/06_realtime_chat_demo_validation_loop.md` - 내부 데모 우선 검증 루프 문서

## Legacy

- `docs/architecture/01_filesystem_first_architecture.md` - 초기 아키텍처 방향 문서
- `docs/devtools/MANDU_KITCHEN_SPEC.md` - 과거 Kitchen 설계 문서
- `docs/devtools/MANDU_KITCHEN_SPEC_2.md` - 과거 Kitchen 설계 반복안
- `docs/devtools/MANDU_KITCHEN_FINAL_SPEC.md` - 과거 Kitchen 설계 기록
- `docs/evaluation/MANDU_EVALUATION.ko.md` - 과거 평가 스냅샷
- `docs/plans/06_mandu_dna_master_plan.md` - 이전 마스터 플랜
- `docs/plans/07_mandu_improvement_proposals.md` - 이전 개선 제안 모음
- `docs/plans/07_product_readiness_plan.md` - 이전 제품 준비 계획
- `docs/plans/08_ont-run_adoption_plan.md` - 이전 도입 계획
- `docs/plans/09_lockfile_integration_plan.md` - 이전 lockfile 연동 계획
- `docs/plans/10_RFC-001-guard-to-guide.md` - 과거 RFC
- `docs/plans/11_openclaw_dna_adoption.md` - 과거 adoption 계획
- `docs/plans/12_mcp_dna_integration.md` - 과거 MCP 통합 계획
- `docs/plans/13_devtool_kitchen_plan.md` - 과거 Kitchen 계획
- `docs/plans/13_devtool_kitchen_dev_spec.md` - 과거 Kitchen 개발 스펙
- `docs/plans/react19-migration.md` - 과거 마이그레이션 메모

---

## 설정 기본값

Mandu는 `mandu.config.ts`, `mandu.config.js`, `mandu.config.json`을 읽습니다.
Guard 전용 오버라이드는 `.mandu/guard.json`도 지원합니다.

- `mandu dev`, `mandu build`는 설정을 검증하고 오류를 출력합니다
- CLI 옵션이 설정값보다 우선합니다
- 로컬 기본 개발 포트는 `3333`입니다

```ts
// mandu.config.ts
export default {
  server: {
    port: 3333,
    hostname: "localhost",
    cors: false,
    streaming: false,
  },
  dev: {
    hmr: true,
    watchDirs: ["src/shared", "shared"],
  },
  build: {
    outDir: ".mandu",
    minify: true,
    sourcemap: false,
  },
};
```

---

## 관리 원칙

- 현재 CLI, 템플릿, 데모, 런타임 동작과 맞는 문서만 `official`로 올립니다.
- TODO가 많거나 워크플로가 흔들리는 문서는 `draft`에 둡니다.
- 더 이상 공식 진입점이 아닌 워크플로와 과거 계획 문서는 `legacy`에 둡니다.
