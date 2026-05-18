# Agent Surface Inventory

작성일: 2026-05-19
기준 계획: `docs/plans/20_agent_surface_consolidation_plan.md`
상태: Phase 1 baseline inventory

---

## 0. Purpose

This inventory is the control sheet for consolidating Mandu's agent-facing surface.
The goal is not to delete existing functionality. The goal is to give agents a
small official path and move specialized or low-level capabilities behind that
path.

Canonical agent loop:

```text
context -> plan -> apply -> verify -> repair
```

Tier definitions:

| Tier | Meaning |
|------|---------|
| Official Agent Path | Default tools/commands agents should use first. |
| Domain Tool | Specialized capability used through plan/apply/verify when relevant. |
| Internal Plumbing | Low-level implementation detail used by official workflows. |
| Deprecated/Legacy | Compatibility or duplicate surface that should be hidden from new docs. |

Risk levels:

| Risk | Meaning |
|------|---------|
| Low | Read-only or pure analysis. |
| Medium | Runs commands, writes generated files, or affects local state. |
| High | Destructive, deploys, mutates production-adjacent config, or starts/stops services. |

---

## 1. CLI Commands

Source: `packages/cli/src/commands/registry.ts`

| Name | Current purpose | Agent value | Overlap | Risk | Tier | New owner workflow | Migration note |
|------|-----------------|-------------|---------|------|------|--------------------|----------------|
| `agent` | Planned consolidated command group. | Highest. This should become the default entry. | Replaces many first-step choices. | Medium | Official Agent Path | context, plan, apply, verify, repair, sync | Add as new top-level command. |
| `info` | Environment, config, health summary. | High for onboarding/context. | Overlaps `ai.brief`, `diagnose`. | Low | Internal Plumbing | context | Keep public for humans; call from `agent context`. |
| `diagnose` | Extended health report. | High for context and verify. | Overlaps `doctor`, `check`, `review`. | Low | Internal Plumbing | context, verify | Normalize into agent diagnostics. |
| `review` | Changed-file guard/contract review. | High for post-edit verification. | Overlaps `guard`, `diagnose`, `check`. | Low | Internal Plumbing | verify | Keep public; call from `agent verify`. |
| `guard` | Architecture guard. | High but too low-level as first choice. | Overlaps `review`, `check`, `fix`. | Low | Domain Tool | verify, repair | Keep domain-specific. |
| `check` | Combined project checks. | High for verify. | Overlaps `diagnose`, `guard`, build gates. | Medium | Internal Plumbing | verify | Agent surface should prefer `agent verify`. |
| `doctor` | Guard failure analysis and patch suggestions. | High for repair. | Overlaps `fix`, `loop.close`. | Medium | Internal Plumbing | repair | Call from `agent repair`. |
| `fix` | Guard healing, diagnostics, optional build verify. | High for repair. | Overlaps `doctor`, `guard.heal`. | High | Internal Plumbing | repair | Keep `--apply` guarded; call only after verify. |
| `skills:generate` | Generate per-project Claude skills. | High for sync. | Overlaps future `agent sync`. | Medium | Internal Plumbing | sync | Move docs to `agent sync`. |
| `skills:list` | List generated skills. | Medium for context. | Overlaps `agent context`. | Low | Internal Plumbing | context, sync | Use for inventory. |
| `mcp` | MCP bridge and IDE registration. | High for setup but broad. | Overlaps `agent sync`. | High | Internal Plumbing | sync | Keep `mcp register`; expose via sync docs. |
| `generate` | Resource/page/API/feature generation. | High for implementation. | Overlaps route/API MCP tools. | Medium | Domain Tool | apply | `agent apply` should choose this or MCP. |
| `scaffold` | Boilerplate generation. | Medium. | Overlaps `generate`, `new`, domain commands. | Medium | Domain Tool | apply | Prefer intent-specific apply tools. |
| `new` | Alias for scaffold. | Low for agents. | Duplicate of `scaffold`. | Medium | Deprecated/Legacy | apply | Hide from agent docs. |
| `routes` | Route inspection/generation surface. | Medium. | Overlaps manifest/spec MCP. | Low | Domain Tool | context, plan, apply | Use when route domain is selected. |
| `contract` | Contract creation/validation. | High for API work. | Overlaps contract MCP. | Medium | Domain Tool | plan, apply, verify | Prefer MCP from agents. |
| `openapi` | OpenAPI generation. | Medium. | Overlaps contract tooling. | Medium | Domain Tool | verify, apply | Keep domain-specific. |
| `design` | DESIGN.md operations. | Medium. | Overlaps design MCP. | Medium | Domain Tool | context, plan, apply, verify | Use for design-system tasks. |
| `deploy:plan` | Infer per-route deploy intent. | Medium. | Overlaps deploy MCP. | Medium | Domain Tool | plan, verify | Keep as deploy-domain plan. |
| `deploy` | Prepare deploy artifacts. | Medium for deploy tasks. | Overlaps deploy preview/check. | High | Domain Tool | apply, verify | Never part of default verify unless deploy domain. |
| `build` | Build client/edge/static outputs. | High for release verify. | Overlaps `check`, MCP build. | Medium | Domain Tool | verify | `agent verify` decides when to run. |
| `test` | Unit/integration/e2e command. | High for verify. | Overlaps MCP run-tests. | Medium | Domain Tool | verify | `agent verify` should produce targeted test plan. |
| `test:auto` | Automated test command. | Medium. | Overlaps `test`, ATE. | Medium | Internal Plumbing | verify | Use only through verify/ATE flows. |
| `test:watch` | Watch tests. | Low for non-interactive agents. | Overlaps `test`. | Medium | Deprecated/Legacy | verify | Hide from agent docs except local dev. |
| `test:heal` | Test repair/heal. | Medium. | Overlaps `repair`, ATE heal. | High | Internal Plumbing | repair | Call through repair only. |
| `ate` | Agent-native testing/exemplar tooling. | High, but specialized. | Overlaps verify/repair. | Medium | Domain Tool | verify, repair | Use when test generation or exemplar context is needed. |
| `ai` | Terminal AI playground. | Low for coding agents. | Overlaps external agents. | Medium | Domain Tool | context, plan | Keep human-facing. |
| `ask` | Local Mandu assistant guidance. | Medium for humans. | Overlaps `agent plan`. | Low | Internal Plumbing | plan | `agent plan` should be canonical. |
| `explain` | Explain guard rule/violation. | Medium. | Overlaps doctor/guard explain. | Low | Internal Plumbing | repair | Use in repair narratives. |
| `brain` | Brain auth/status commands. | Medium. | Supports doctor/plan. | High | Internal Plumbing | context, plan, repair | Keep out of default loop unless configured. |
| `watch` | Brain/watch warnings. | Low for batch agents. | Overlaps dev guard. | Medium | Domain Tool | verify | Human/dev-server mode only. |
| `monitor` | Monitoring command. | Low for core workflow. | Overlaps Kitchen/devtools. | Medium | Domain Tool | context | Keep for observability tasks. |
| `preview` | Preview app. | Medium for visual validation. | Overlaps dev/start. | Medium | Domain Tool | verify | Use only for preview tasks. |
| `dev` | Start dev server. | Medium for app testing. | Overlaps MCP dev.start. | High | Domain Tool | verify | Agents should start only when needed. |
| `start` | Start production server. | Medium for smoke testing. | Overlaps deploy/runtime. | High | Domain Tool | verify | Use after build in smoke workflow. |
| `clean` | Remove build artifacts. | Low for agents. | None. | High | Domain Tool | repair | Use only with explicit reason. |
| `init` | Retrofit current directory. | Medium for setup. | Overlaps create/project.init. | High | Domain Tool | sync, apply | Not part of existing-project loop. |
| `create` | Scaffold new Mandu project. | Medium for setup. | Overlaps project.init. | High | Domain Tool | apply | New-project flow only. |
| `add` | Add packages/features. | Low until scoped. | Overlaps generate/scaffold. | High | Domain Tool | apply | Require plan before use. |
| `lock` | Config/lockfile workflow. | Medium for safety. | Overlaps diagnose/check. | Medium | Domain Tool | verify, repair | Use for lockfile/config tasks. |
| `change` | Change snapshot/status. | Medium. | Overlaps git/status. | Low | Domain Tool | context, verify | Useful for context. |
| `cache` | Cache management. | Low. | None. | High | Domain Tool | repair | Not default. |
| `middleware` | Middleware scaffold. | Medium. | Overlaps scaffold/generate. | Medium | Domain Tool | apply | Prefer plan/apply. |
| `session` | Session scaffold. | Medium. | Overlaps auth/scaffold. | Medium | Domain Tool | apply | Prefer plan/apply. |
| `auth` | Auth scaffold. | Medium. | Overlaps session/middleware. | Medium | Domain Tool | apply | Prefer plan/apply. |
| `ws` | WebSocket scaffold. | Medium. | Overlaps scaffold. | Medium | Domain Tool | apply | Prefer plan/apply. |
| `collection` | Content collection scaffold. | Medium. | Overlaps scaffold/generate. | Medium | Domain Tool | apply | Prefer plan/apply. |
| `db` | DB migrations/seeds. | Medium. | None. | High | Domain Tool | plan, apply, verify | Require explicit DB domain. |
| `desktop` | Desktop target scaffold/build. | Low for default workflow. | Overlaps build/deploy. | High | Domain Tool | plan, apply, verify | Specialized. |
| `upgrade` | Update packages or binary. | Low for coding tasks. | None. | High | Domain Tool | sync | Human approval in docs. |
| `completion` | Shell completion. | None for agents. | None. | Low | Deprecated/Legacy | none | Human CLI only. |

---

## 2. MCP Tools

Source: `packages/mcp/src/tools/*.ts`

The consolidation target is to add `mandu.agent.*` tools and make them the
default profile. Existing domain tools remain available in `agent-full`.

| Category | Tools | Agent value | Overlap | Risk | Tier | New owner workflow | Migration note |
|----------|-------|-------------|---------|------|------|--------------------|----------------|
| agent | `mandu.agent.context`, `mandu.agent.plan`, `mandu.agent.apply`, `mandu.agent.verify`, `mandu.agent.repair` | Highest. Official agent loop. | Wraps most other tools. | Medium | Official Agent Path | all | Planned; implement as new category. |
| docs | `mandu.docs.search`, `mandu.docs.get` | High grounding value. | None. | Low | Official Agent Path | context, plan, repair | Keep exposed in `agent-core`. |
| ai-brief | `mandu.ai.brief` | High context value. | Overlaps context/info. | Low | Internal Plumbing | context | Wrap into `mandu.agent.context`. |
| loop-close | `mandu.loop.close` | High repair value. | Overlaps doctor/fix. | Low | Internal Plumbing | repair | Wrap into `mandu.agent.repair`. |
| run-tests | `mandu.run.tests` | High verification value. | Overlaps CLI test. | Medium | Internal Plumbing | verify | Wrap into `mandu.agent.verify`. |
| guard | `mandu.guard.check`, `mandu.guard.analyze`, `mandu.guard.heal`, `mandu.guard.explain` | High architecture value. | Overlaps doctor/fix/review. | Medium | Domain Tool | verify, repair | Expose in `agent-full`; call from verify/repair. |
| spec/routes | `mandu.route.list`, `mandu.route.get`, `mandu.route.add`, `mandu.route.delete`, `mandu.manifest.validate` | High route value. | Overlaps CLI routes/generate. | High for writes | Domain Tool | context, plan, apply, verify | Route writes should be plan-gated. |
| generate | `mandu.generate`, `mandu.generate.status` | High apply value. | Overlaps scaffold/generate CLI. | Medium | Domain Tool | apply | Use through apply when possible. |
| composite | `mandu.feature.create`, `mandu.diagnose`, `mandu.island.add`, `mandu.middleware.add`, `mandu.test.route`, `mandu.deploy.check`, `mandu.cache.manage` | Medium. Convenient but mixed concerns. | Overlaps many domain tools. | High | Internal Plumbing | apply, verify, repair | Avoid default exposure until normalized. |
| contract | `mandu.contract.list`, `mandu.contract.get`, `mandu.contract.create`, `mandu.contract.link`, `mandu.contract.validate`, `mandu.contract.sync`, `mandu.contract.openapi` | High API confidence value. | Overlaps CLI contract/openapi. | Medium | Domain Tool | context, plan, apply, verify | Expose in `agent-full`. |
| slot | `mandu.slot.read`, `mandu.slot.validate`, `mandu.slot.constraints` | High filling/slot value. | Overlaps slot skills. | Low | Domain Tool | context, verify, repair | Add create/fill later if missing. |
| hydration | `mandu.build`, `mandu.build.status`, `mandu.island.list`, `mandu.hydration.set`, `mandu.hydration.addClientSlot` | High island/hydration value. | Overlaps build/generate. | Medium | Domain Tool | context, apply, verify, repair | Expose in `agent-full`; default via verify. |
| resource | `mandu.resource.create`, `mandu.resource.list`, `mandu.resource.get`, `mandu.resource.addField`, `mandu.resource.removeField` | Medium. | Overlaps generate resource. | Medium | Domain Tool | context, plan, apply, verify | Plan-gate schema mutations. |
| design | `mandu.design.get`, `mandu.design.prompt`, `mandu.design.check`, `mandu.component.list`, `mandu.design.extract`, `mandu.design.patch`, `mandu.design.propose`, `mandu.design.diff_upstream` | Medium/high for UI consistency. | Overlaps design CLI. | High for patch. | Domain Tool | context, plan, apply, verify | Expose for design tasks. |
| component | `mandu.component.add` | Medium. | Overlaps generate/scaffold. | Medium | Domain Tool | apply | Plan-gate. |
| deploy-plan | `mandu.deploy.plan`, `mandu.deploy.compile` | Medium. | Overlaps deploy:plan. | Medium | Domain Tool | plan, verify | Deploy domain only. |
| deploy-preview | `mandu.deploy.preview` | Medium. | Overlaps preview/deploy. | High | Domain Tool | verify | Deploy domain only. |
| lint | `mandu.lint`, `mandu.lint.setup` | Medium/high. | Overlaps check/verify. | Medium | Internal Plumbing | verify, sync | Wrap into verify/sync. |
| project | `mandu.project.init`, `mandu.dev.start`, `mandu.dev.stop` | Medium. | Overlaps init/dev. | High | Domain Tool | apply, verify | Not default; starting/stopping services must be explicit. |
| brain/watch | `mandu.brain.doctor`, `mandu.watch.start`, `mandu.watch.status`, `mandu.watch.stop`, `mandu.brain.checkLocation`, `mandu.brain.checkImport`, `mandu.brain.architecture`, `mandu.brain.status`, `mandu.brain.login`, `mandu.brain.logout` | Medium. | Overlaps doctor/context. | High | Internal Plumbing | context, repair, sync | Hide from default profile. |
| ate legacy | `mandu_ate_context`, `mandu_ate_prompt`, `mandu_ate_exemplar`, `mandu_ate_run`, `mandu_ate_flakes`, `mandu_ate_save`, `mandu_ate_boundary_probe`, `mandu_ate_recall`, `mandu_ate_remember`, `mandu_ate_coverage`, `mandu_ate_mutate`, `mandu_ate_mutation_report`, `mandu_ate_oracle_pending`, `mandu_ate_oracle_verdict`, `mandu_ate_oracle_replay` | High for tests, but too specialized. | Overlaps ATE v2 and verify. | Medium | Internal Plumbing | verify, repair | Keep in internal/ATE profile. |
| ate dotted | `mandu.ate.extract`, `mandu.ate.generate`, `mandu.ate.run`, `mandu.ate.report`, `mandu.ate.heal`, `mandu.ate.impact`, `mandu.ate.auto_pipeline`, `mandu.ate.feedback`, `mandu.ate.apply_heal`, `mandu.test.smart`, `mandu.test.coverage`, `mandu.test.precommit` | High, specialized. | Overlaps run-tests/test. | High for heal. | Domain Tool | verify, repair | Expose only when test generation/heal is selected. |
| runtime | `mandu.runtime.config`, `mandu.runtime.contractOptions`, `mandu.runtime.setNormalize`, `mandu.runtime.loggerOptions`, `mandu.runtime.loggerConfig` | Medium. | Overlaps config/check. | Medium | Domain Tool | context, apply, verify | Runtime domain only. |
| seo | `mandu.seo.preview`, `mandu.seo.sitemap`, `mandu.seo.robots`, `mandu.seo.jsonld`, `mandu.seo.write`, `mandu.seo.analyze` | Medium. | Overlaps SEO CLI/docs. | Medium | Domain Tool | plan, apply, verify | SEO domain only. |
| kitchen | `mandu.kitchen.errors`, `mandu.devtools.context` | Medium context/debug value. | Overlaps context/devtools. | Low | Domain Tool | context, repair | Devtools mode only. |
| decisions | `mandu.decision.list`, `mandu.decision.save`, `mandu.decision.check`, `mandu.decision.architecture` | Medium architecture value. | Overlaps docs/context. | Medium | Domain Tool | context, plan, verify | Use for architecture-significant changes. |
| transaction | `mandu.tx.begin`, `mandu.tx.commit`, `mandu.tx.rollback`, `mandu.tx.status` | Medium safety value. | None. | High | Internal Plumbing | apply, repair | Future apply/repair should use transaction locks. |
| history | `mandu.history.list`, `mandu.history.snapshot`, `mandu.history.prune` | Medium rollback/context value. | Overlaps tx. | High for prune. | Internal Plumbing | context, repair | Hide prune from default. |
| negotiate | `mandu.negotiate`, `mandu.negotiate.scaffold`, `mandu.negotiate.analyze` | Medium planning value. | Overlaps agent plan. | Medium | Internal Plumbing | plan | Fold useful pieces into `agent.plan`. |
| refactor | `mandu.refactor.rewrite_generated_barrel`, `mandu.refactor.migrate_route_conventions`, `mandu.refactor.extract_contract` | High migration value. | Overlaps repair/apply. | High | Domain Tool | plan, apply, repair | Dry-run default; explicit domain only. |

---

## 3. Skills

Source: `packages/mcp/src/resources/skills/*`

| Name | Current purpose | Agent value | Overlap | Risk | Tier | New owner workflow | Migration note |
|------|-----------------|-------------|---------|------|------|--------------------|----------------|
| `mandu-agent-workflow` | Planned root skill for canonical loop. | Highest. | Wraps domain skills. | Low | Official Agent Path | all | Add as the default first skill. |
| `mandu-fs-routes` | Filesystem route rules. | High. | Route MCP/docs. | Low | Domain Tool | plan, apply, verify | Done: Agent Workflow Contract added. |
| `mandu-hydration` | Island/partial hydration rules. | High. | Hydration MCP/build. | Low | Domain Tool | plan, apply, verify, repair | Done: Agent Workflow Contract added. |
| `mandu-slot` | Filling/slot conventions. | High. | Slot MCP. | Low | Domain Tool | plan, apply, verify, repair | Done: Agent Workflow Contract added. |
| `mandu-guard` | Architecture guard guidance. | High. | Guard MCP/doctor. | Low | Domain Tool | verify, repair | Done: low-level guard commands moved behind agent verify. |
| `mandu-testing` | Testing patterns. | High. | ATE/run-tests. | Low | Domain Tool | verify, repair | Done: low-level test commands routed through agent verify. |
| `mandu-deployment` | Deploy guidance. | Medium. | Deploy CLI/MCP. | Medium | Domain Tool | plan, apply, verify | Done: provider snippets framed as post-plan examples. |
| `mandu-security` | Security guidance. | High for sensitive tasks. | Guard/contract/runtime. | Medium | Domain Tool | plan, verify, repair | Done: Agent Workflow Contract added. |
| `mandu-performance` | Performance guidance. | Medium. | Build/analyze/perf tests. | Medium | Domain Tool | verify, repair | Done: Agent Workflow Contract added. |
| `mandu-styling` | Styling rules. | Medium. | Design/ui skills. | Low | Domain Tool | plan, apply, verify | Done: setup snippets framed as post-plan examples. |
| `mandu-ui` | UI integration patterns. | Medium. | Design/styling. | Low | Domain Tool | plan, apply, verify | Done: setup snippets framed as post-plan examples. |
| `mandu-composition` | Component composition patterns. | Medium. | UI/styling/hydration. | Low | Domain Tool | plan, apply, verify | Done: Agent Workflow Contract added. |

---

## 4. Immediate Consolidation Decisions

1. Add a new `agent` CLI group instead of renaming existing commands.
2. Add a new `agent` MCP category instead of moving existing tools first.
3. Start with `context` and `verify`; they reduce the most confusion with the least behavioral risk.
4. Keep low-level tools public for one release, but mark official docs and skills to prefer `agent.*`.
5. Add MCP profiles only after `mandu.agent.context` exists, so the reduced profile still has enough context.
6. Add `mandu-agent-workflow` as the root skill before rewriting domain skills.

---

## 5. Implementation Checklist

- [x] Baseline CLI inventory completed.
- [x] Baseline MCP inventory completed.
- [x] Baseline skill inventory completed.
- [x] `mandu agent context --json`
- [x] `mandu.agent.context`
- [x] `.mandu/agent-manifest.json` read/write path
- [x] `mandu agent plan "<task>" --json`
- [x] `mandu.agent.plan`
- [x] `mandu agent apply --from .mandu/agent-plan.json`
- [x] `mandu.agent.apply`
- [x] `mandu agent verify --changed --json`
- [x] `mandu.agent.verify`
- [x] `mandu agent repair --from .mandu/agent-verify.json`
- [x] `mandu.agent.repair`
- [x] `mandu agent sync --target all`
- [x] `mandu.agent.sync`
- [x] `mandu-agent-workflow` skill
- [x] MCP profile `agent-core`
- [x] Domain skill second pass: all domain `SKILL.md` files declare Agent Workflow Contract.
- [x] Low-level guard/test/setup examples are framed behind `mandu agent plan/verify`.
