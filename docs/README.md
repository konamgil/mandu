# Mandu Documentation

This index uses three document labels:

| Label | Meaning | How to use it |
|------|---------|---------------|
| `official` | Current, recommended, and aligned with the active Mandu workflow | Safe for onboarding and day-to-day reference |
| `draft` | In progress, incomplete, or still moving with active product decisions | Read only when you are intentionally exploring that area |
| `legacy` | Historical, superseded, or archival design material | Do not use as your first entrypoint |

If you are new to Mandu, stay inside the `official` section until your app is running.

---

## Start Here

1. `docs/guides/01_configuration.md` - Current configuration, runtime defaults, and dev/build behavior
2. `docs/api/api-reference.md` - Current public API surface
3. `docs/status.md` - Implementation matrix synced to the codebase
4. `docs/plans/14_top_tier_framework_priority_plan.md` - Current execution priorities for framework quality

---

## Official

- `docs/guides/01_configuration.md` - Canonical configuration guide
- `docs/api/api-reference.md` - Canonical API reference
- `docs/status.md` - Current implementation status
- `docs/product/01_mandu_product_brief.md` - Product direction and framing
- `docs/architecture/02_mandu_technical_architecture.md` - Current technical architecture overview
- `docs/architecture/05_mandu_backend-architecture-guardrails.md` - Backend guardrails
- `docs/specs/05_fs_routes_system.md` - FS Routes reference
- `docs/specs/06_mandu_guard.md` - Guard architecture reference
- `docs/specs/07_seo_module.md` - SEO module reference
- `docs/specs/08_runtime_status_code_policy.md` - Runtime HTTP status code policy
- `docs/guides/04_prisma.md` - Official Prisma integration guide
- `docs/guides/05_realtime_chat_starter.md` - Official realtime starter guide
- `demo/README.md` - Official demo index and current demo status
- `docs/plans/14_top_tier_framework_priority_plan.md` - Current top-tier roadmap

## Draft

- `docs/comparison/manifest-vs-resource.md` - Incomplete comparison of legacy manifest flow vs resource flow
- `docs/guides/resource-workflow.md` - Add-on resource workflow tutorial, not the default onboarding path
- `docs/guides/resource-troubleshooting.md` - In-progress troubleshooting guide for the resource workflow
- `docs/migration/to-resources.md` - In-progress migration guide from legacy manifests to resources
- `docs/guides/06_realtime_chat_demo_validation_loop.md` - Internal demo-first validation loop

## Legacy

- `docs/architecture/01_filesystem_first_architecture.md` - Early architecture direction
- `docs/devtools/MANDU_KITCHEN_SPEC.md` - Historical Kitchen design spec
- `docs/devtools/MANDU_KITCHEN_SPEC_2.md` - Historical Kitchen design iteration
- `docs/devtools/MANDU_KITCHEN_FINAL_SPEC.md` - Historical Kitchen design record
- `docs/evaluation/MANDU_EVALUATION.ko.md` - Historical evaluation snapshot
- `docs/plans/06_mandu_dna_master_plan.md` - Older master plan
- `docs/plans/07_mandu_improvement_proposals.md` - Older proposal set
- `docs/plans/07_product_readiness_plan.md` - Older readiness plan
- `docs/plans/08_ont-run_adoption_plan.md` - Older adoption plan
- `docs/plans/09_lockfile_integration_plan.md` - Older integration plan
- `docs/plans/10_RFC-001-guard-to-guide.md` - Historical RFC
- `docs/plans/11_openclaw_dna_adoption.md` - Historical adoption plan
- `docs/plans/12_mcp_dna_integration.md` - Historical MCP integration plan
- `docs/plans/13_devtool_kitchen_plan.md` - Historical Kitchen plan
- `docs/plans/13_devtool_kitchen_dev_spec.md` - Historical Kitchen development spec
- `docs/plans/react19-migration.md` - Historical migration note

---

## Configuration Defaults

Mandu loads configuration from `mandu.config.ts`, `mandu.config.js`, or `mandu.config.json`.
For Guard-only overrides, `.mandu/guard.json` is also supported.

- `mandu dev` and `mandu build` validate the config and print errors if invalid
- CLI flags override config values
- The default local dev server port is `3333`

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

## Maintenance Rule

- Move a document to `official` only when it matches current CLI, templates, demos, and runtime behavior.
- Keep TODO-heavy or unstable workflow docs in `draft`.
- Keep superseded workflow docs and old planning artifacts in `legacy`.
