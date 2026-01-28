---

title: Backend Architecture Guardrails Plan (v2)
doc_level: overview
owner: architecture-team
status: active
last_update: 2025-10-15
tags:

* architecture
* backend
* automation
* ai-agents
  related:
* ./agents-guide-overview.md
* ./architecture/frontend-architecture.md
* ./backend/nestjs-module-guide.md

---

# Backend Architecture Guardrails Plan (v2)

This document defines the target backend architecture, tooling, and operational guardrails required to keep the codebase consistent while multiple AI agents contribute in parallel. It supersedes the initial draft and adds exception handling, read-model guidance, observability, selective CI, and compliance guardrails.

---

## 1. Goals

* Declare boundaries, naming, and architectural rules that can be statically verified and enforced automatically.
* Provide an **AI golden path** (generate → implement → verify) and **guardrails** (lint, dependency checks, CI gates) so that violations are immediately detected and corrected.
* Align the backend architecture with the frontend FSD approach (public APIs, layered boundaries, standardized scaffolding).
* Add **controlled exceptions (allowlist + expiry)** to enable safe migration without weakening rules.
* Ensure **observability, security/compliance**, and **selective build/test** for scale.

---

## 2. Target Architecture Overview

* **Style:** Modular monolith with layered/hexagonal influence.
* **Layers:**

  * `api`: Controllers/Gateways for HTTP & realtime interfaces.
  * `application`: UseCases (Command/Query handlers), DTOs, mappers, application events.
  * `domain`: Entities, Value Objects, Domain Services, Domain Events, Repository interfaces.
  * `infra`: Prisma repositories, external adapters (HTTP, NATS, etc.), mappers, **QueryProvider (read-only projections)**.
  * `core/shared`: Prisma service & UoW, NATS client, logging, configuration, common errors/results/utilities.
* **Repository pattern:** Interfaces live in `domain`, implementations in `infra` only.
* **UseCases:** Every write via CommandHandler (transactional), every read via QueryHandler; controllers invoke handlers exclusively.
* **Read projections:** QueryHandlers may call **read-only `QueryProvider` in `infra/prisma/query-provider.ts`** to return projection DTOs without round-tripping through domain.

---

## 3. Directory Layout

```
apps/api/src/
├── main.ts
├── app.module.ts
├── core/
│   ├── prisma/
│   ├── nats/
│   ├── logger/
│   ├── config/
│   ├── http/filters|guards|interceptors
│   └── bus/
├── shared/
│   ├── errors/
│   ├── result/
│   └── utils/
└── modules/
    └── <domain>/
        ├── domain/{entities,value-objects,services,events,repositories}
        ├── application/{commands,queries,dto,mappers,events,index.ts}
        ├── infra/{prisma,http,nats,mappers,query-provider.ts}
        ├── api/{<domain>.controller.ts,<domain>.gateway.ts}
        └── <domain>.module.ts
```

Each domain module exposes its public surface via `modules/<domain>/application/index.ts`. No other internal path may be imported from outside.

---

## 4. Architectural Boundaries & Guardrails

| Rule                  | Description                                                                                                      | Enforcement                                                         |                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| Dependency direction  | `api → application → domain`. `infra` depends on `application                                                    | domain` for abstractions only.                                      | `eslint-plugin-boundaries`, dependency-cruiser |
| Public API only       | Cross-module imports must use `modules/<domain>/application/index.ts`.                                           | `enforce-public-api` script, `import/no-internal-modules`, DangerJS |                                                |
| Infra leakage         | `domain`/`application` cannot import Prisma/axios/socket or other IO libraries.                                  | `no-restricted-imports`, semgrep                                    |                                                |
| Repository placement  | Interfaces in `domain/repositories`, Prisma implementations in `infra/prisma`.                                   | Scaffolding templates + `validate:backend-architecture` script      |                                                |
| DTO/Mapper discipline | DTOs live in `application/dto`, mapping through `application/mappers`; Prisma↔Domain mappers in `infra/mappers`. | Scaffolding + review checklist                                      |                                                |
| UoW usage             | Write use-cases must wrap multi-repo work inside UnitOfWork.                                                     | `@Transactional()` decorator + CI warnings for uncovered handlers   |                                                |
| Read projections      | QueryHandlers may use `infra/.../query-provider.ts` for read-optimized projection DTOs (no domain traversal).    | Boundaries rules + review checklist                                 |                                                |

**Controlled exceptions (allowlist):** temporary violations must include an inline annotation and expire.

```ts
// @arch-allow: prisma-leak UNTIL=2025-12-31 REASON=legacy-migration
```

* Exceptions are tracked in `docs/architecture/allowlist.md` and enforced by semgrep + CI (expired exceptions fail CI).

---

## 5. Static Analysis Tooling

| Tool                            | Purpose                                                                        | Notes                                                                |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `eslint-plugin-boundaries`      | Layer & module boundaries                                                      | Configure element types for `domain`, `application`, `infra`, `api`. |
| `import/no-internal-modules`    | Forbid deep imports into other modules                                         | Allowlist only `<domain>/application/index`.                         |
| `dependency-cruiser`            | Detect forbidden edges/cycles; explicit allowed graph                          | CI fails on violations; maintain allowed graph per module.           |
| `semgrep`                       | Detect Prisma/axios/socket usage in forbidden layers; enforce allowlist expiry | Custom rules in `semgrep.yml`.                                       |
| `scripts/enforce-public-api.ts` | Reject imports that bypass public barrel                                       | Run in CI & pre-commit hooks.                                        |

`pnpm validate:backend-architecture` aggregates all checks for local and CI execution.

**Sample snippets** (minimal, for reference):

```js
// .dependency-cruiser.cjs (fragment)
module.exports = {
  forbidden: [
    { name: "layer-direction",
      from: { path: "apps/api/src/modules/.*/api" },
      to:   { pathNot: "apps/api/src/modules/.*/application" } },
    { name: "no-prisma-leak",
      from: { path: "apps/api/src/modules/.*/(domain|application)" },
      to:   { path: "@prisma/client" } },
    { name: "cross-module-through-barrel",
      from: { path: "apps/api/src/modules/.*/application/.+" },
      to:   { path: "apps/api/src/modules/([^/]+)/((domain|infra)/|application/(?!index\\.ts))" } }
  ]
}
```

```yaml
# semgrep.yml (fragment)
rules:
- id: prisma-leak-in-app
  pattern: |
    import { $X } from "@prisma/client"
  paths:
    include: ["apps/api/src/modules/**/(domain|application)/**/*.ts"]
  message: "Prisma is infra-only. Use repositories."
  severity: ERROR
- id: arch-allow-expired
  pattern: "// @arch-allow: $RULE UNTIL=$DATE"
  languages: [typescript]
  severity: ERROR
  # Implement date comparison in CI wrapper script
```

---

## 6. AI Golden Path & Scaffolding

### CLI Templates

* `pnpm gen:module <domain>`: Creates domain/application/infra/api skeleton, tokens, module wiring, and test stubs.
* `pnpm gen:usecase <domain> <Action>`: Produces Command + Handler + DTO + mapper + tests; auto-registers in application index.
* `pnpm gen:repository <domain>`: Adds repository interface, Prisma implementation scaffold, and module binding.

### Required Workflow

1. **Generate** using the CLI (scaffold manifest records commands).
2. **Implement** inside the generated structure (UseCase logic, repository implementation, DTO mapping).
3. **Verify** locally: `pnpm validate:backend-architecture && pnpm lint && pnpm test`.
4. **Document**: record generation commands in commit/PR template.

### Scaffold Manifest

* `scaffold-manifest.json` tracks generated artifacts.
* CI fails if new files are not represented in the manifest (prevents ad-hoc file creation).

---

## 7. CI & Git Workflow

| Stage               | Checks                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Pre-commit          | `pnpm lint`, `pnpm validate:backend-architecture`                                                |
| Pre-push            | dependency-cruiser, semgrep, **selective tests** (affected modules)                              |
| PR (GitHub Actions) | `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm validate:backend-architecture`, optional smoke/e2e |
| DangerJS            | Automated comments for boundary/public API violations and missing scaffold logs                  |
| Branch Protection   | All checks must pass; merges blocked otherwise                                                   |

**CI optimization:** run builds and tests **selectively** based on changed modules using the dependency graph (dep-cruise) or Nx affected commands. Enable pnpm & TS build cache.

Violations are blocking; warnings are treated as failures (`--max-warnings=0`).

---

## 8. DTO & API Contract Management

* DTOs reside in `application/dto`.
* Controllers convert request payloads into DTOs, invoke UseCase handlers, and map responses back to DTOs.
* DTO → Domain → Prisma mapping handled via `application/mappers` and `infra/mappers`.
* **OpenAPI sync:** `check-openapi-controllers` script validates that controller signatures match the OpenAPI spec.
* **Frontend sync:** a generated TypeScript SDK (`pnpm generate:sdk`) keeps frontend FSD slices aligned with backend DTOs; runs automatically when DTO PRs merge.
* **Error contract (Problem JSON):** All exceptions return RFC 7807 Problem JSON via global ExceptionFilter with fields: `type`, `title`, `status`, `detail`, `instance`, `traceId`.

---

## 9. Testing Strategy

| Layer       | Test Type      | Target                                        |
| ----------- | -------------- | --------------------------------------------- |
| Domain      | Unit tests     | Entities, Value Objects, Domain Services      |
| Application | UseCase tests  | Command/Query handlers with fake repositories |
| Infra       | Integration    | Prisma repositories against test DB           |
| API         | E2E            | Controller ↔ UseCase ↔ Repository             |
| Events      | Scenario tests | Domain/Application event flows                |

**KPI:** write handlers 100% covered by transactional path tests; read queries use projection providers in tests.

---

## 10. Observability Baseline

* **Logging:** Pino with structured logs; inject `requestId`/`traceId` into all logs (correlation).
* **Tracing (optional but recommended):** OpenTelemetry spans for HTTP handlers, Prisma queries, and outbound HTTP/NATS. Service name: `lamy-work-api`.
* **Metrics:** Emit counters/histograms per use-case.

  * Naming convention: `usecase.<domain>.<action>.{success|error|duration_ms}`
  * Export via Prometheus or OTLP.

---

## 11. Security & Compliance Guardrails

* **Authorization at UseCase entry:** role/tenant guard executed **inside handlers**, not only in controllers.
* **PII redaction:** configure `pino-redact` for sensitive fields (email, phone, tokens, addresses) in logs.
* **Secrets management:** `.env` schema validated with Zod; secrets decrypted at runtime only; separate keys for local/CI.
* **Audit log:** critical use-cases (create/delete/role-change) emit append-only audit events with `actor`, `target`, `timestamp`, `traceId`.

---

## 12. Exception Allowlist & Expiry

* Temporary exceptions must be annotated inline and recorded in `docs/architecture/allowlist.md`.
* CI validates **expiry**; expired entries fail the pipeline.

**Annotation format:**

```ts
// @arch-allow: <rule-id> UNTIL=YYYY-MM-DD REASON=<short-text>
```

**Lifecycle:** request → review approval → add annotation + allowlist entry → track until removal.

---

## 13. Metrics Dashboard Spec

* **Core panels:** use-case success rate, error rate, p95 duration, boundary violations/week, selective CI savings (runtime vs full), DB query p95.
* **Breakdown:** by domain/action, by handler type (command/query), by tenant (if applicable).
* **Alerts:** sustained error rate > 2% (5m), p95 > SLO, boundary violations > threshold.

---

## 14. Rollback / Recovery Policy

* **Schema migrations:** adopt **expand/contract**. Provide down migrations; feature flags for gradual exposure.
* **Release rollback:** blue/green or canary where possible; maintain `ROLLBACK.md` per release.
* **Message processing:** idempotency keys; retry with backoff; DLQ for poison messages; replay procedure documented.

---

## 15. Roadmap

1. **Tooling setup:** add ESLint boundaries, dependency-cruiser (with allowed graph), semgrep rules (with allowlist expiry), enforce-public-api script, and `validate:backend-architecture`.
2. **Pilot module (e.g., `work`):** refactor to domain/application/infra/api layout; introduce repository interfaces & UseCases; ensure public API barrels; add read-only QueryProvider.
3. **CI & hooks:** enable pre-commit/pre-push; configure GitHub Actions; protect main branch; enable selective builds/tests and caching.
4. **Gradual rollout:** extend structure to other modules (knowledge, chat, auth, etc.); unify logging/observability and Problem JSON; implement security/compliance guards.
5. **Dashboards & automation:** architecture violations dashboard; codemod auto-fixes; manifest-based change tracking & release note automation.

---

## 16. Appendix: Reference Snippets

**ESLint (IO ban example):**

```js
// .eslintrc.cjs (fragment)
rules: {
  "no-restricted-imports": ["error", {
    patterns: [
      { group: ["@prisma/client", "axios", "node:fs", "socket.io"], message: "External IO allowed in infra only" }
    ]
  }]
}
```

**Package scripts (validation chain):**

```json
{
  "scripts": {
    "arch:deps": "depcruise -c .dependency-cruiser.cjs apps/api/src --output-type err-long",
    "arch:semgrep": "semgrep --config semgrep.yml",
    "validate:backend-architecture": "pnpm -s arch:deps && pnpm -s arch:semgrep && node scripts/enforce-public-api.mjs",
    "precommit": "pnpm lint && pnpm test && pnpm validate:backend-architecture",
    "prepush": "pnpm validate:backend-architecture && pnpm build"
  }
}
```

**Problem JSON example:**

```json
{
  "type": "https://lamy.work/errors/invalid_state",
  "title": "Invalid state",
  "status": 409,
  "detail": "Task cannot transition from DONE to IN_PROGRESS.",
  "instance": "/api/tasks/123",
  "traceId": "01HX7MZ7G2B2KZ4V2Q9M4M3T2W"
}
```

**Metric names (examples):**

```
usecase.work.create.success
usecase.work.create.error
usecase.work.create.duration_ms
```

---

**Contact:** architecture team · see `docs/agents-guide-overview.md` for AI agent prompts and PR templates.
