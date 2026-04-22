---
name: mandu-mcp-deploy
description: |
  빌드/배포 파이프라인 워크플로우. "배포", "deploy", release 전 자동 호출.
  deploy.check 는 fail-fast 게이트. deploy.preview 로 프로덕션 리허설.
  manual build + guard + seo 나열 대신 aggregate 도구 사용.
---

# Mandu MCP Deploy

프로덕션 배포 직전의 **fail-fast 파이프라인**. 개별 검증 도구를 손으로 나열하는
대신, `mandu.deploy.check` 와 `mandu.deploy.preview` 집계 도구를 쓴다.

## Trigger

- "배포", "release", "deploy"
- release tag 직전, `git push origin main` 직전
- 프로덕션 환경 업로드 전
- CI/CD 에서 deploy job 이전
- `mandu-deploy` task-shaped skill 이 활성화될 때

## Recipe (순서 고정, 게이트 엄격)

```
mandu_build                     ← 프로덕션 빌드 시작
  └─> mandu_build_status        ← green 대기 (polling)
       └─> mandu.deploy.check   ← Tier-0 aggregate: guard+contract+manifest 병렬
            │                      ─ fail → 즉시 중단, deploy_preview 금지
            └─> mandu_write_seo_file  ← sitemap/robots/meta 확정
                 └─> mandu.deploy.preview ← 프로덕션 리허설 (Tier-0)
                      └─> 사용자에게 배포 승인 요청
                           └─> (사용자 승인) 외부 배포 실행
```

## Step Detail

### Step 1 — `mandu_build`

```
mandu_build({ profile: "production" })
```

alias of `mandu.build`. 프로덕션 번들 생성. 반환에 jobId / status 포함.
이 호출은 비동기일 수 있다 — 즉시 반환 후 Step 2 로 poll.

### Step 2 — `mandu_build_status` (poll until green)

```
mandu_build_status({ jobId })
```

alias of `mandu.build.status`. status ∈ {pending, running, success, failed}.

- `success` → Step 3
- `failed` → 중단, 빌드 에러 분석 후 `mandu-mcp-verify` 로 이동
- `running` → 짧은 간격으로 재호출

CRITICAL: 빌드 `failed` 이면 **`mandu.deploy.check` 절대 호출하지 않는다**.
빌드가 깨진 상태에서 deploy check 를 돌리면 잘못된 positive/negative 가 나온다.

### Step 3 — `mandu.deploy.check` (Fail-Fast Gate)

```
mandu.deploy.check({ target: "bun" })
```

반환:
- `ok: true` → Step 4 로 진행
- `ok: false, blockers: [...]` → **즉시 중단**

blockers 예시:
- guard 위반 (레이어, 금지 import)
- contract validation 실패
- manifest 깨짐 (route 누락 / 중복)

각 blocker 는 가리키는 도구가 있다:
- guard → `mandu_guard_explain`, `mandu_guard_heal` (단, safe-change 감싸기)
- contract → `mandu_validate_contracts`, `mandu_create_contract`
- manifest → `mandu_validate_manifest`

blocker 를 고치면 Step 1 부터 재실행. `deploy_preview` 로 건너뛰지 않는다.

### Step 4 — `mandu_write_seo_file`

```
mandu_write_seo_file({ target: "sitemap" })
mandu_write_seo_file({ target: "robots" })
mandu_write_seo_file({ target: "meta" })
```

alias of `mandu.seo.write`. 프리뷰 도구 (`mandu_preview_seo`) 가 아니라
**실제 파일 기록**. 배포 전에 `public/sitemap.xml`, `public/robots.txt` 가 고정돼야 함.

선택 사항: 먼저 `mandu_preview_seo` 로 결과 확인 후 `mandu_write_seo_file`.
CI 에서는 바로 write.

### Step 5 — `mandu.deploy.preview`

```
mandu.deploy.preview({ port: 4173 })
```

프로덕션 빌드를 로컬에서 serve. 스모크 테스트 용도:
- 초기 페이지 로드
- 주요 라우트 200
- critical island 하이드레이션
- SEO 파일 서빙

preview 가 깨지면 배포 금지.

### Step 6 — 외부 배포 (프레임워크 밖)

Docker / Fly / Vercel / Cloudflare 등. 이 단계는 mandu MCP 범위 밖이므로
`mandu-deploy` (task-shaped skill) 의 Dockerfile / CI 예시 참조.

## 절대 규칙

| # | 규칙 | 이유 |
|---|------|------|
| D-1 | `deploy.check` 실패 → **즉시 중단**, preview 금지 | fail-fast. 깨진 빌드를 preview 해도 의미 없음 |
| D-2 | 빌드 `failed` → `deploy.check` **호출 금지** | 빌드 산출물이 없는데 check 돌리면 false negative |
| D-3 | `mandu_write_seo_file` 은 **check green 이후** | check 실패 상태로 SEO 쓰면 잘못된 meta 확정 |
| D-4 | preview 깨지면 **배포 중단** | 로컬에서 안 뜨는 빌드가 프로덕션에서 뜰 리 없다 |
| D-5 | 개별 검증 (`guard_check`, `validate_contracts`, `validate_manifest`) 를 **손으로 나열하지 않는다** | `deploy.check` 가 이들을 병렬 집계. 수동 나열 = AP-7 (index 참조) |
| D-6 | deploy.check blocker 를 `guard_heal` / refactor 로 고칠 땐 **safe-change 래핑** | 프로덕션 직전 파일 수정은 위험 변경 |

## Anti-patterns

### AP-7 — Manual Build Pipeline (index AP-7 재인용)
- 증상: 배포 전에 `mandu_build` + `mandu_guard_check` + `mandu_validate_contracts` + `mandu_validate_manifest` + `mandu_preview_seo` 를 손으로.
- 왜 안 되나: `mandu.deploy.check` 가 이 시퀀스를 병렬 집계로 이미 처리. 수동 나열은 왕복 5배 + 순서 오류 가능.
- 대응: `mandu.deploy.check` 한 방.

### AP — preview 스킵
- 증상: `deploy.check` 통과했다고 바로 외부 배포.
- 왜 안 되나: check 는 정적 검증. 실제 serve 에서만 드러나는 런타임 에러 (island 하이드레이션, SSR 에러, asset 경로) 가 누락.
- 대응: Step 5 필수.

### AP — write 전에 preview
- 증상: `mandu_preview_seo` → `mandu.deploy.preview` → `mandu_write_seo_file`.
- 왜 안 되나: preview 가 아직 안 쓰인 SEO 파일로 돌면 실제 배포와 차이. write 를 preview 전에.
- 대응: Step 4 → Step 5 순서 지킨다.

### AP — 빌드 실패 후 check 강행
- 증상: `mandu_build_status` 가 `failed` 인데 "뭐라도 확인해보자" 로 `deploy.check`.
- 왜 안 되나: 빌드 산출물 없이 돌린 check 는 신뢰 불가. 왕복 낭비.
- 대응: D-2, 빌드 고친 뒤 Step 1 부터.

### AP — blocker 를 배포 전에 급하게 heal
- 증상: `deploy.check` 위반을 `guard_heal` 로 바로 수정 후 다시 check.
- 왜 안 되나: 배포 직전 수정은 위험 변경. 스냅샷 없이 자동수정 = 롤백 어려움.
- 대응: D-6, `mandu-mcp-safe-change` 래퍼 안에서 heal.

## Quick Reference

```
release 준비
  mandu_build                  (1 call)
  mandu_build_status           (poll, 1~n calls)
  mandu.deploy.check           (1 call, fail-fast gate)
    └ blocker 있으면 safe-change 로 escalate
  mandu_write_seo_file         (1~3 calls)
  mandu.deploy.preview         (1 call)
  ────────────────────────────
  green → 외부 배포
  실패   → 해당 단계에서 중단, 원인 수정 후 처음부터
```

표준 호출 수: **5~8** (polling 제외). 수동 파이프라인 (AP-7) 은 12+.

## See Also

- `mandu-mcp-index` — AP-7 (manual build pipeline), Tier-0 aggregate 규칙
- `mandu-mcp-verify` — blocker 진단 / drill-down
- `mandu-mcp-safe-change` — 배포 직전 수정은 safe-change 필수
- `mandu-deploy` — Dockerfile / nginx / CI 설정 (외부 배포 단계)
