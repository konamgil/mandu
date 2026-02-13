# Mandu Documentation

Quick links to project docs:

- `docs/api/api-reference.md` — Core API reference
- `docs/status.md` — Implementation status (done/partial/not started)
- `docs/product/01_mandu_product_brief.md` — Product brief
- `docs/architecture/02_mandu_technical_architecture.md` — Technical architecture (MVP-0.1)
- `docs/guides/01_configuration.md` — Configuration guide
- `docs/guides/03_mandu_coding_agent_prompt_template.md` — Coding agent prompt template
- `docs/guides/05_realtime_chat_starter.md` — Official realtime chat starter template guide
- `docs/specs/04_mandu_hydration_system.md` — Hydration system spec
- `docs/specs/05_fs_routes_system.md` — FS Routes system spec
- `docs/specs/06_mandu_guard.md` — Mandu Guard architecture spec
- `docs/specs/07_seo_module.md` — SEO module spec (NEW)
- `docs/architecture/05_mandu_backend-architecture-guardrails.md` — Backend guardrails
- `docs/architecture/06_mandu_router_v5_hybrid_trie.md` — Router v5 hybrid trie
- `docs/plans/06_mandu_dna_master_plan.md` — DNA master plan (code-informed)
- `docs/evaluation/MANDU_EVALUATION.ko.md` — Evaluation (Korean)

---

## Configuration

Mandu loads configuration from `mandu.config.ts`, `mandu.config.js`, or `mandu.config.json`.
For guard-only overrides, `.mandu/guard.json` is also supported.

- `mandu dev` and `mandu build` validate the config and print errors if invalid
- CLI flags override config values

```ts
// mandu.config.ts
export default {
  server: {
    port: 3000,
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
  guard: {
    preset: "mandu",
    srcDir: "src",
    exclude: ["**/*.test.ts"],
    realtime: true,
  },
  seo: {
    enabled: true,
    defaultTitle: "My App",
    titleTemplate: "%s | My App",
  },
};
```

---

## Document Status (Updated 2026-02-03)

| Doc | Status | Note |
|-----|--------|------|
| `docs/api/api-reference.md` | updated | SEO API 추가 (2026-02-02) |
| `docs/api/api-reference.ko.md` | updated | Client API 추가 (2026-01-30) |
| `docs/status.md` | updated | SEO 섹션 추가 (65 features) (2026-02-02) |
| `docs/specs/07_seo_module.md` | new | SEO 모듈 스펙 (2026-02-02) |
| `docs/product/01_mandu_product_brief.md` | updated | MCP/CLI 목록 및 로드맵 노트 갱신 (2026-01-30) |
| `docs/architecture/02_mandu_technical_architecture.md` | updated | 구현 현황/CLI/MCP 도구 반영 (2026-01-30) |
| `docs/guides/01_configuration.md` | new | Configuration guide (2026-02-03) |
| `docs/guides/03_mandu_coding_agent_prompt_template.md` | updated | CLI 명칭 정정 (2026-01-30) |
| `docs/specs/04_mandu_hydration_system.md` | updated | 구현 현황/MCP 도구 반영 (2026-01-30) |
| `docs/specs/05_fs_routes_system.md` | updated | Config note added (2026-02-03) |
| `docs/specs/06_mandu_guard.md` | updated | Config example aligned (2026-02-03) |
| `docs/architecture/05_mandu_backend-architecture-guardrails.md` | moved | Moved from repo root on 2026-01-28 |
| `docs/architecture/06_mandu_router_v5_hybrid_trie.md` | updated | 구현 상태 표시 추가 (2026-01-30) |
| `docs/plans/06_mandu_dna_master_plan.md` | moved + updated | References updated on 2026-01-28 |
| `docs/evaluation/MANDU_EVALUATION.ko.md` | moved | Moved from repo root on 2026-01-28 |
| `docs/README.md` | updated | Configuration section added (2026-02-03) |
| `docs/README.ko.md` | updated | 설정 섹션 추가 (2026-02-03) |

## Removed / Deprecated

| Doc | Status | Note |
|-----|--------|------|
| `07_mandu_dna_expanded_plan.md` | removed | Merged into `docs/plans/06_mandu_dna_master_plan.md` on 2026-01-28 |
