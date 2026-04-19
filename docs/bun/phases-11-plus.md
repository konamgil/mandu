---
title: "Phase 11+ 로드맵 — 완성도 · Testing · CLI · AI · Edge"
status: master-plan
created: 2026-04-19
supersedes: docs/bun/phases-4-plus.md §7 (Phase 8) when Phase 17 materializes
---

# Phase 11+ Master Plan

Phase 0~9 (기반 → DB → Auth → 프로덕션 → HMR → OS 통합) 완료 후, Phase 10 (mandujs.com docs 사이트) 과 병행하여 **5 개 독립 트랙**으로 Mandu 확장. 각 트랙은 R0 진단 병렬 파견 중이며, 진단 결과에 따라 R1 스코프 확정.

| Phase | 주제 | 기간 | 상태 |
|---|---|---|---|
| **11** | 완성도 스프린트 (9.1 follow-up + 7.4) | 1~2일 | R0 진단 중 |
| **12** | Testing 생태계 (`mandu test` + ATE 확장) | 2~3주 | R0 진단 중 |
| **13** | CLI 명령 확장 (`deploy`/`seed`/`upgrade`/`mcp`) | 1~2주 | R0 진단 중 |
| **14** | AI/Agent 통합 심화 | 2~3주 | R0 진단 중 |
| **15** | Edge runtime adapter (`@mandujs/edge`) | 1~2주 | R0 진단 중 |
| 16 (optional) | Browser Playground (WebContainers) | 2주 | Phase 10 후 |
| 8 (optional) | 관측성 (tracing + Prometheus) | 2주 | 운영 피드백 필요시 |

---

## 1. 트랙 독립성 분석

5 개 트랙의 **파일 영역 충돌 매트릭스**:

| | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|
| **11** | — | - | `.github/workflows/` 일부 | - | - |
| **12** | - | — | `cli/commands/test.ts` | ATE 확장 공유 | - |
| **13** | `packages/cli/src/commands/` | `cli/commands/test.ts` | — | `cli/commands/ai.ts` 공유 | deploy adapter 일부 |
| **14** | - | ATE 확장 공유 | `cli/commands/ai.ts` | — | - |
| **15** | - | - | deploy adapter 일부 | - | — |

**병렬 실행 가능 묶음**:
- **Wave A** (완전 독립): Phase 11 + Phase 15 (edge) — 0 충돌
- **Wave B** (일부 공유): Phase 12 + Phase 13 + Phase 14 — `cli/commands/` 섹션 분리 필요

---

## 2. 실행 순서 추천

### Option A — 우선순위 기반 순차 (안전)
1. Phase 11 (1~2일, 완성도 먼저)
2. Phase 12 (2~3주, 가장 큰 가치)
3. Phase 13 (1~2주, Phase 12 test 인프라 재활용)
4. Phase 14 (2~3주, Phase 12+13 위에 AI 통합)
5. Phase 15 (1~2주, 독립적이라 언제든)

**총 wall clock**: 6~11주

### Option B — 병렬 최대화 (공격적)
1. Phase 11 먼저 (1~2일)
2. Phase 12 + 13 + 15 동시 시작 (각 R0 끝난 후)
3. Phase 14 는 12/13 완료 후
4. Wall clock: 3~4주

### Option C — 가치 우선 (추천)
1. Phase 11 (1~2일)
2. **Phase 12 + 14 병렬** — 가장 차별화 가치 큰 것 먼저
3. Phase 13 + 15 병렬 (12/14 진행 중)
4. Wall clock: 4~5주

---

## 3. R0 진단 → R1 기획 플로우

각 Phase 는 기존 Phase 4c/7/9 패턴 따름:
- **R0 진단** (진행 중): 에이전트 1명이 범위 + 아키텍처 + 우선순위 조사
- **Pre-R1**: 내가 직접 공유 타입/계약 작성
- **R1 구현**: 에이전트 병렬 (파일 경계 엄격)
- **R2 검증**: 통합 E2E + benchmark
- **R3 보안 감사**

## 4. 우선순위 판단 기준

| 기준 | 가중치 |
|---|---|
| **사용자 체감 가치** (실제 DX 개선) | 높음 |
| **Mandu 차별화** (경쟁 대비) | 높음 |
| **완성도** (기존 기능 마감) | 중간 |
| **미래 확장성** (새 시장) | 중간 |

Phase 11 (완성도) · Phase 12 (Testing) · Phase 14 (AI) 가 차별화에 가장 기여. Phase 13 (CLI 확장) 은 DX. Phase 15 (Edge) 는 시장 확장.

---

## 5. 미해결 결정 포인트

1. **Phase 14 의 AI Provider 기본값** — Claude / GPT / local Ollama 중 어느 것을 default?
2. **Phase 15 Edge 우선 타깃** — Cloudflare Workers (제약 많지만 시장 큼) vs Deno Deploy (유연) vs Vercel (통합도)
3. **Phase 13 deploy adapter 우선** — Vercel (가장 익숙) vs Fly.io (Bun 친화) vs Railway (간단)
4. **Phase 12 Testing unit vs E2E 우선** — unit (`bun test` 통합) 먼저 vs E2E (ATE 확장) 먼저
5. **Phase 11 code signing** — Apple Developer ID ($99/y) + Windows EV ($300~500/y) 연간 비용 감당?

---

## 6. 공통 품질 게이트

1. 각 Phase `bun run typecheck` 4 packages clean (NODE_OPTIONS=--max-old-space-size=8192)
2. 기존 테스트 regression 0 (core + cli + mcp + ate baseline 유지)
3. R3 Critical/High 0 — merge gate
4. 공유 타입 파일 사전 작성 (Pre-R1) 필수
5. 파일 경계 엄격 (Phase 7/9 때 A/B/C/D 에이전트 성공 패턴)

---

## 7. 리스크

| 리스크 | 완화 |
|---|---|
| **병렬 에이전트 수 증가로 토큰 비용 폭증** | Wave 단위 병렬 (한 번에 최대 4 에이전트) |
| **각 Phase R0 결과가 기존 기획과 크게 어긋남** | 진단 결과 보고 후 사용자 재확인 |
| **npm publish 자주 필요** (패키지 의존성 변경) | Phase 단위 단일 publish cycle |
| **파일 경계 충돌** (특히 Phase 13/14 가 cli/commands 공유) | Pre-R1 에서 line 범위 엄격 명시 |
| **Phase 15 Edge 의 Bun-native API 포기** | adapter 별 optional, Bun 기본 유지 |

---

## 8. 진행 상황 추적

현재 (2026-04-19):
- [x] Master Plan 문서 (본 문서)
- [x] Phase 11.R0 진단 파견
- [x] Phase 12.R0 진단 파견
- [x] Phase 13.R0 진단 파견
- [x] Phase 14.R0 진단 파견
- [x] Phase 15.R0 진단 파견
- [ ] R0 결과 종합 → 각 Phase team plan
- [ ] Option A/B/C 순서 선택
- [ ] Phase 11 R1 착수
- [ ] Wave 병렬 실행

---

*진단 결과 수집 후 이 문서 §2 실행 순서 확정.*
