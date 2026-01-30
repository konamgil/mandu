# 만두 기획안 (v0.2) — Agent‑Native Fullstack Framework + MCP

> 목적: **에이전트가 코딩해도 아키텍처가 무너지지 않는 개발 OS**를 만든다.  
> 핵심: **코드 = 산출물, Spec(JSON) = 단일 진실원천(SSOT)**

---

## 1. 배경과 문제 정의

### 1.1 현재 AI 코딩의 구조적 문제
- 에이전트가 코딩할수록 **폴더 구조/레이어 규칙/코딩 패턴이 흔들림**
- Lint로 사후 수습하려다 **부작용(추가 오류) + 시간 손실**이 커짐
- 프로젝트마다 **아키텍처가 매번 달라져** 재현성과 유지보수가 급격히 나빠짐

### 1.2 우리가 해결하려는 본질
- “AI가 코딩해주는 속도”가 아니라,
- **AI가 망가뜨리지 못하는 구조(Architecture Preservation)**를 강제하는 것

---

## 2. 제품 정의

### 2.1 한 줄 설명
**자연어 → MCP(기획/스펙 작성) → Generate(뼈대 생성) → Slot(로직) → Guard/Tests → Report**까지 자동화하는, **Bun+TS+React 기반 Agent‑Native 풀스택 프레임워크**

### 2.2 핵심 철학(불변 원칙)
1) **Spec(JSON)이 SSOT**다. 코드는 spec의 산출물이다.  
2) **generated는 언제든 날리고 재생성 가능**해야 한다.  
3) 에이전트는 **슬롯(허용 영역)에서만** 작업한다.  
4) Lint는 최소화하고, **Guard가 구조 보존의 주인공**이 된다.  
5) 실패 시 **Self‑Correction Loop(자동 재시도)**를 기본 탑재한다.

---

## 3. 타겟 사용자/사용 시나리오(명확화)

### Primary Target
**에이전트 + 감독자(개발자/테크리드/운영 책임자)**  
- 인간: 승인/검토/디버깅/운영 판단
- 에이전트: spec 작성 + 슬롯 로직 구현 + 테스트 작성

### Secondary Target(후순위)
- 비개발자 + 에이전트: Guard 피드백 이해 장벽 → 이후 단계
- 에이전트 완전 자율: 비목표

> 결론: 현실적으로 **감독자 모드**를 1급 기능으로 포함해야 함

---

## 4. 기술 방향(상위 결정)

- Runtime: **Bun** (Bun.serve를 코어로 직접 사용, 타 프레임워크 위에 얹지 않음)
- Language: **TypeScript**
- Front Rendering: **React**
- Fullstack: **SSR 기본**, (MVP 이후) **ISR**, **WebSocket 플랫폼** 제공
- DB: 특정 DB/ORM 강제하지 않고 **Adapter 인터페이스만 제공**

---

## 5. SSOT 스펙 체계(버전/락/롤백 포함)

### 5.1 SSOT 파일(모두 JSON)
- `spec/routes.manifest.json`
- `spec/channels.manifest.json` (후속)
- `spec/contracts/*.json` (후속)
- `spec/isr.policy.json` (후속)
- `spec/plan.json` (후속)

### 5.2 버전/락/롤백(필수)
- `spec/spec.lock.json`: 적용된 스펙의 해시/메타
- `spec/history/snapshots/<id>.snapshot.json`: 커밋 스냅샷(옵션→필수로 확장)

### 5.3 변경 트랜잭션 ✅ (구현 완료)
- `change.begin()` → (spec 변경/생성) → `guard.check()` + `tests.run()` → `change.commit()`
- 실패 시 `change.rollback()`으로 깨끗하게 복구

**트랜잭션 API (SpecTransaction)**:
```typescript
const tx = new SpecTransaction(projectRoot);
tx.begin("Add users API");           // 스냅샷 생성
// ... spec 변경, 코드 생성, 슬롯 작성 ...
tx.commit();                          // 히스토리에 저장
// 또는
tx.rollback();                        // 스냅샷으로 완전 복원
```

**스냅샷 구조**:
- `timestamp`: 생성 시간
- `message`: 변경 설명
- `manifest`: routes.manifest.json 백업
- `lock`: spec.lock.json 백업
- `slotContents`: 슬롯 파일 전체 백업

---

## 6. 슬롯(Slot) 모델 고도화(표현력 확보)

단일 logic 슬롯은 현실 프로젝트 표현력이 부족하므로 **타입을 분리**한다.

- **route-logic slot**: loader/action이 호출하는 비즈니스 로직
- **channel-logic slot**: WS 메시지 핸들러 로직
- **shared-logic slot**: 공통 유틸/정책
- **adapter-impl slot**: redis/db/pubsub 구현체
- **middleware slot**: 인증/로깅/레이트리밋 등 횡단 관심사

> 슬롯 타입별로 Guard가 **허용 import/API/테스트 구조**를 다르게 강제한다.

---

## 7. SSR/ISR 전략(기술 부채 관리)

### 7.1 SSR은 “최소 기능”부터
- Next가 수년간 해결한 고난도(Streaming, Hydration edge cases)는 MVP에서 제외
- MVP는 **renderToString 기반 SSR**로 제한하여 위험 축소

### 7.2 ISR은 “public only”로 단순화(평가 반영)
- `authScope != public` 이면 ISR 금지(Guard)
- user/admin 영역은 SSR fallback으로 안전성 확보
- 파라미터 세밀 제어/고급 캐시 키는 MVP 이후

---

## 8. WebSocket(채팅)은 “플랫폼”만 제공(모드 분리)

### 8.1 제공 범위
- 채팅 기능 세트(읽음/첨부/권한 등)는 비목표
- 제공: upgrade/auth/rooms/broadcast/send + 확장 훅

### 8.2 운영 모드 2개(명확 분리)
- **Local Mode**: 단일 프로세스, rooms in-memory, 설정 없이 동작
- **Distributed Mode**: pubsub/session/roomstore 필요, eventual consistency 전제  
  → 전환은 “설정 변경”이 아니라 “마이그레이션”으로 취급

---

## 9. 테스트 전략(3계층)

1) **Spec Tests(자동)**: 스키마/충돌/정합성
2) **Generated Smoke Tests(자동)**: 컴파일/최소 호출
3) **Logic Tests(작성 강제)**: 슬롯 로직 유닛 테스트(기준 미달 시 Guard)

---

## 10. 디버깅/가독성: generated → spec/slot 매핑 1급화

- `generated.map.json`을 생성해
- 런타임 에러가 발생하면 “generated가 아니라 **어떤 spec/slot을 고쳐야 하는지**” 안내
- 에러를 `SPEC_ERROR / LOGIC_ERROR / FRAMEWORK_BUG`로 분류

---

## 11. Guard 전략(Strict/Loose + 설명 + 자동 재시도)

- **loose 모드**: MVP 초기(속도 우선)
- **strict 모드**: 안정화/오픈소스 품질 단계
- 실패 시 Guard는 반드시:
  - ruleId, file, message, suggestion(대안 슬롯/명령) 제공
- MCP는 실패 시 **자동 재시도(Max N)** 루프 지원
- spec 변경은 **Human‑in‑the‑loop 승인 모드** 옵션 제공

---

## 12. 로드맵(MVP 재조정)

### MVP‑0.1 ✅
- Spec 기반 라우트 생성 + 최소 SSR 동작
- Guard: spec/generated/슬롯 경계 오염 방지
- CLI: spec‑upsert / generate / guard / build / dev

### MVP‑0.3 ✅ (현재)
- route‑logic 슬롯 시스템
- **MCP 서버** (`@mandujs/mcp`) - AI 에이전트 통합
- **트랜잭션 API** (begin/commit/rollback)
- **스냅샷 기반 히스토리** - 완전 복원 지원
- **에러 분류 시스템** (SPEC_ERROR / LOGIC_ERROR / FRAMEWORK_BUG)
- **generated.map.json** - 런타임 에러 → spec/slot 매핑

> 구현 현황 노트 (2026-01-30): Hydration 스펙/번들러/런타임, Client Router, Streaming SSR, HMR, Router v5가 코드에 포함됨 (실험적/확장 기능).

### MVP‑0.4
- 기본 테스트 템플릿 + self‑correction loop

### MVP‑0.5
- WS 플랫폼 + channel‑logic 슬롯 + contract-first

### MVP‑1
- ISR(public only) + CacheStore adapter
- distributed WS mode + 공식 redis adapter(선택)

---

## 13. 오픈소스/설치 전략

- UX 목표: express/next처럼 **`bunx mandu init`** (또는 **`bunx @mandujs/cli init`**)로 프로젝트 생성
- 패키지 구성:
  - `@mandujs/core` - 런타임, SSR, Guard, Spec 스키마, 트랜잭션 API ✅
  - `@mandujs/cli` - init, spec-upsert, generate, guard, build, dev, contract, openapi, change, doctor, watch, brain ✅
  - `@mandujs/mcp` - MCP 서버 (AI 에이전트 통합) ✅
  - `@mandujs/adapters-*` - redis/pubsub/session/cache (후속)

### MCP 서버 (`@mandujs/mcp`)
AI 에이전트가 Mandu 프레임워크를 직접 조작하는 MCP 서버:

**도구 (Tools)**:
- Spec 관리: `mandu_list_routes`, `mandu_add_route`, `mandu_update_route`, `mandu_delete_route`, `mandu_validate_spec`
- 코드 생성: `mandu_generate`, `mandu_generate_status`
- 트랜잭션: `mandu_begin`, `mandu_commit`, `mandu_rollback`, `mandu_tx_status`
- 히스토리: `mandu_list_history`, `mandu_get_snapshot`, `mandu_prune_history`
- 가드: `mandu_guard_check`, `mandu_analyze_error`
- 슬롯: `mandu_read_slot`, `mandu_write_slot`
- Hydration: `mandu_build`, `mandu_build_status`, `mandu_list_islands`, `mandu_set_hydration`, `mandu_add_client_slot`
- Contract: `mandu_list_contracts`, `mandu_get_contract`, `mandu_create_contract`, `mandu_update_route_contract`, `mandu_validate_contracts`, `mandu_sync_contract_slot`, `mandu_generate_openapi`
- Brain: `mandu_doctor`, `mandu_watch_start`, `mandu_watch_status`, `mandu_watch_stop`, `mandu_check_location`, `mandu_check_import`, `mandu_get_architecture`

**리소스 (Resources)**:
- `mandu://spec/manifest` - routes.manifest.json
- `mandu://spec/lock` - spec.lock.json
- `mandu://generated/map` - generated.map.json
- `mandu://transaction/active` - 활성 트랜잭션 정보

---

## 14. 이번 스프린트 성공 정의
- “Spec→Generate→Guard→SSR” 4단계를 **완전 자동화**하고,
- 사람이 generated/spec를 직접 만지면 **즉시 막히며**, 어디를 고쳐야 하는지 **설명**된다.
