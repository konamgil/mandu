---
phase: 14
track: R0
status: Design
audience: DX / AI-Agent / Platform
last_verified: 2026-04-18
bun_version: 1.3.12
depends_on:
  - docs/ATE-ROADMAP-v1.md
  - docs/MCP-ROADMAP-v1.md
  - packages/ate/
  - packages/mcp/
  - packages/skills/
---

# Phase 14 R0 — AI/Agent 통합 심화 설계

> Mandu 의 "Agent-Native Fullstack Framework" 포지션을 코드 레벨로 뒷받침하는 설계. 현재 ATE / `@mandujs/mcp` / `@mandujs/skills` / `brain` 네 축을 "에이전트가 끝까지 주도할 수 있는" 워크플로우로 결속한다.

---

## 1. 현재 AI 기능 인벤토리 (코드 기준)

| 축 | 경로 | 현재 기능 | 공백 |
|---|---|---|---|
| **ATE** | `packages/ate/src/` (26 files) | `extract / generate / run / report / heal / impact / precommit` 파이프 + `oracle (L0~L3)` + `contract-parser` + `side-effect-scanner` + `trace-parser` | L2/L3 oracle 일부 placeholder · prompt 표준화 없음 · regression 예측 없음 · 자동 PR 없음 |
| **MCP server** | `packages/mcp/src/` (~21 tool 모듈) | `spec / generate / transaction / history / guard / decisions / negotiate / slot / hydration / contract / brain / runtime / seo / project / ate / resource / component / kitchen / composite` + profiles ([`profiles.ts`](../../../packages/mcp/src/profiles.ts)) + prompts 3종 ([`prompts.ts`](../../../packages/mcp/src/prompts.ts): `new-feature / debug / add-crud`) | `benchmark / test_gen / migration / guard_explain(자연어)` 도구 없음 · prompt 빈약 |
| **Skills** | `packages/skills/skills/` (9 skills) + `packages/mcp/src/resources/skills/` (11 resource skills) | 정적 SKILL.md · `mandu-skills install` CLI | 프로젝트별 동적 skill 생성 없음 |
| **Brain** | `packages/core/src/brain/` ([`brain.ts`](../../../packages/core/src/brain/brain.ts), [`memory.ts`](../../../packages/core/src/brain/memory.ts), `adapters/ollama.ts`) | Doctor (guard 위반 분석) + Watch (파일 변경 경고) + Ollama 로컬 LLM | Anthropic / OpenAI 어댑터 없음 · session memory만 (장기 persistence 없음) |
| **CLI** | `packages/cli/src/commands/` | `ask / explain / brain setup / test-auto / test-heal / generate-ai` | `ai chat` (대화형 playground) 없음 · `skills:generate` 없음 |
| **Guard** | `packages/core/src/guard/` + preset `mandu` | 6 preset (`fsd / clean / hexagonal / atomic / cqrs / mandu`) — 에이전트 친화 구조 강제 | 위반 시 자연어 설명 부족 |

**포지셔닝 핵심**: ATE + MCP + Guard 가 "에이전트 코딩의 세 기둥". **서로 feedback 하는 루프가 약함** — Phase 14 의 과제.

## 2. ATE 심화 5 확장

### 2.1 Prompt 라이브러리 표준화 (`packages/ate/src/prompts/`)
- 현재 `heal.ts` 내부 inline prompt. Claude/GPT/Gemini 공통 시스템 프롬프트 부재.
- 신규 `prompts/` + `getPrompt(kind, vars)` API. 전부 [XML-tag 구조](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags) 로 통일.
- 버전 잠금: `.mandu/ate/prompt-lock.json` 으로 회귀 방지.

### 2.2 Context budget (smart trim)
- 현재 `extract` 가 전체 InteractionGraph dump — 대형 repo 에서 context 초과.
- route-level hash + usage frequency → `smart-select.ts` 가 top-K만 포함. 플래그: `--ctx-tokens 30000`.

### 2.3 Agent self-test (cross-LLM verification)
- ATE 생성 L2/L3 assertion 을 **다른 LLM** 이 검증. 2-of-3 (Claude + GPT + Ollama) 합의 시 green · 불일치 시 `tests/quarantine/` 로 격리. 전제: 2.1.

### 2.4 Regression prediction
- `impact.ts` + git diff → 변경이 **깰 테스트 확률** 예측. 학습 소스: `.mandu/ate/runs/*/summary.json`. 출력: `mandu test:predict --head HEAD --base main`.

### 2.5 Auto-PR (fix 제안)
- `heal` 결과 → `gh pr create` 자동 호출. 안전장치: `--safe-mode` 기본 · 에이전트 서명 · reviewer label 필수.

**우선순위**: 2.1 (2d) → 2.2 (3d) → 2.4 (5d) → 2.3 (5d) → 2.5 (3d). ~18d.

## 3. Claude Code Skills Auto-Gen 설계

현재 [`packages/skills/skills/`](../../../packages/skills/skills/) 는 정적 9개 · [`mandu-skills install`](../../../packages/skills/src/cli.ts) 은 copy-only. 모든 프로젝트가 동일 skill.

**신규 `mandu skills:generate`**:
- 입력: `.mandu/manifest.json` + contracts + `guard.preset` + 최근 `git log`.
- 출력: `.claude/skills/<project>-*.md`
  - `<proj>-domain-glossary.md` — resource/contract 에서 추출한 도메인 용어 사전
  - `<proj>-workflow.md` — 최근 6주 git history 기반 커맨드 레시피
  - `<proj>-conventions.md` — guard 위반 이력 기반 프로젝트 패턴
- 엔진: Bun.file + [core/src/generator](../../../packages/core/src/generator) 재사용 (신규 dep 없음).
- **추가**: `AGENTS.md` / `CLAUDE.md` 표준 템플릿을 `mandu init` 에 흡수.

## 4. `mandu ai chat` 설계 (내장 playground)

**Provider** — `@mandujs/core/ai` (신규 배럴, 기존 `brain/adapters/base.ts` `LLMAdapter` 재사용):
- `OllamaAdapter` (기존) · `AnthropicAdapter` (`@anthropic-ai/sdk`, caching + 1M) · `OpenAIAdapter` · `BunFetchAdapter` (generic).
- 선택: `.mandu/ai.config.ts` (`{ provider, model, apiKey: env("...") }`).

**UI**:
1. **CLI TUI** — `packages/cli/src/commands/ai-chat.ts` + `Bun.markdown` 렌더 (v1.3.12). 저장: `.mandu/chat-history/`.
2. **Desktop** — 기존 `packages/core/src/desktop` + `Bun.WebView` (Phase 9.1). 웹 UI + diff preview.

**Context auto-injection**: manifest · 최근 guard report · 최근 commit 3개. 토큰 예산 `--ctx-tokens` (§2.2 공유).

**Security**:
- API key: `Bun.secrets` (OS keychain) · 파일 저장 금지.
- Approval gate: diff 출력 + `y/n`. 자동 적용 `--yes` (default off).
- 전송 whitelist: manifest · diff · 에러 로그. `.env` / `secrets/` 절대 금지.

## 5. MCP tool registry 확장

현재 [`tools/index.ts`](../../../packages/mcp/src/tools/index.ts) 에 21 카테고리. 추가 4개:

| 신규 도구 | 목적 | 구현 근거 |
|---|---|---|
| `mandu.benchmark` | 에이전트가 `bun:test --bench` 실행 + perf delta 보고 | [`@mandujs/core/perf`](../../../packages/core/src/perf) 이미 존재 |
| `mandu.test.gen` | 특정 파일 · 함수 → 테스트 코드 생성 (ATE L0~L3 재사용) | [`ate/unit-codegen.ts`](../../../packages/ate/src/unit-codegen.ts) 확장 |
| `mandu.guard.explain.nl` | 위반 코드 + rule → 자연어 설명 (prompt 표준) | 기존 `mandu.guard.explain` (구조화) + §2.1 prompt |
| `mandu.migration.suggest` | `@mandujs/core` 버전 업 → breaking change 자동 패치 제안 | [`breaking-changes.md`](../phase-10-diagnostics/breaking-changes.md) + ts-morph codemod |

**프로필 업데이트**: 기본 `full` · 신규 `agent-deep` 프로필에 위 4개 포함.

## 6. Prompt Engineering 표준화

**`docs/prompts/` (신규)**: `system-mandu.md` (guard · bun · workspace 규칙) · `system-ate-heal.md` · `system-negotiate.md` · `system-review.md`. 모두 XML 구조 + 모델별 variant.

**자동 주입**: `mandu init` → `CLAUDE.md` + `AGENTS.md` 생성 · `.claude/settings.json` 에 system prompt 경로 삽입. `@mandujs/cli` 번들.

## 7. Workflow — Plan → Scaffold → Test → Deploy

신규 MCP prompt `mandu.workflow.ship` (기존 `new-feature/debug/add-crud` 에 추가): negotiate → scaffold → ate.extract+generate → ate.run+heal → guard.check → preview → deploy.

**Multi-agent 예시 (선택)**: `demo/multi-agent-starter/` — planner/coder/tester/reviewer role 분담. Claude API `tool_use` + Mandu MCP 결합 orchestrator (~200 LoC).

## 8. AI 도구 호환성

| 도구 | 지원 경로 | 설정 산출물 |
|---|---|---|
| **Claude Code** | 네이티브 (MCP + Skills + CLAUDE.md) | `.mcp.json`, `.claude/skills/`, `CLAUDE.md` |
| **Cursor** | MCP (공통) | `.cursor/mcp.json` (Mandu MCP 자동 등록) |
| **Continue** | MCP | `~/.continue/config.json` 스니펫 제공 |
| **Aider** | `CLAUDE.md` / `AGENTS.md` 공용 읽기 | `AGENTS.md` 템플릿 표준화 |
| **Copilot** | 제한적 (closed) | `.github/copilot-instructions.md` (guard rule 요약) |

`mandu init --ai <tool>` 플래그로 해당 설정 자동 생성 (default: all).

## 9. Phase 14 분할

### 14.1 — Foundation (2주, `minor`)
- §2.1 Prompt 라이브러리 (ATE)
- §5 MCP 도구 4개 중 `guard.explain.nl` + `test.gen`
- §6 prompt 표준 + `mandu init` 에 AGENTS.md/CLAUDE.md 자동 생성
- §8 `mandu init --ai cursor|continue|claude`

### 14.2 — Playground (2~3주, `minor`)
- §4 `mandu ai chat` CLI + Anthropic/OpenAI adapter
- §3 `mandu skills:generate` (프로젝트별 skill)
- `Bun.secrets` 기반 API key 관리
- §5 `mandu.benchmark` 도구

### 14.3 — Loop Closure (3주, `minor+`)
- §2.2 context budget + §2.3 self-test + §2.4 regression prediction
- §2.5 Auto-PR (opt-in)
- §7 `workflow.ship` prompt + `demo/multi-agent-starter/`
- §5 `mandu.migration.suggest`

## 10. 우선순위 & 예상

| 항목 | 섹션 | 가치 | 비용 | 우선 |
|---|---|---|---|---|
| Prompt 표준화 | §2.1 §6 | 모든 LLM 기능의 기반 | 2d | 🔥 |
| `mandu init` AI 설정 자동화 | §8 | 신규 사용자 onboarding | 1d | 🔥 |
| `guard.explain.nl` MCP | §5 | 가장 자주 막히는 장애물 설명 | 2d | 🔥 |
| `skills:generate` | §3 | 프로젝트별 Claude Code 경험 | 3d | ⚡ |
| `ai chat` CLI + Anthropic | §4 | Playground · 차별화 포인트 | 5d | ⚡ |
| Context budget | §2.2 | 대형 repo 지원 전제 | 3d | ⚡ |
| Benchmark MCP | §5 | perf 측정 자동화 | 2d | 🎯 |
| Regression prediction | §2.4 | CI 고도화 | 5d | 🎯 |
| Agent self-test | §2.3 | 신뢰도 향상 | 5d | 🧪 |
| Auto-PR | §2.5 | 완전 자율 루프 | 3d | 🧪 |
| Multi-agent demo | §7 | 마케팅 · 예시 | 4d | 🧪 |
| Migration MCP | §5 | 버전 업 UX | 5d | 🧪 |

**합계**: 14.1 ~10d · 14.2 ~12d · 14.3 ~17d = **총 ~8주** (1인, 직렬). §14.1 + §14.2 병렬화 시 ~6주.

## 참고

- Claude Code skills: https://docs.claude.com/en/docs/claude-code/skills
- MCP spec: https://modelcontextprotocol.io/specification
- Claude Sonnet 4.7 1M context: https://docs.anthropic.com/en/docs/about-claude/models
- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Bun 1.3.12 `Bun.secrets` / `Bun.WebView` / `Bun.markdown`: https://bun.com/docs
- 내부: [`ATE-ROADMAP-v1.md`](../../ATE-ROADMAP-v1.md) · [`MCP-ROADMAP-v1.md`](../../MCP-ROADMAP-v1.md) · [`phases-4-plus.md`](../phases-4-plus.md)
