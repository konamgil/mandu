---
name: mandu-guard
description: |
  Architecture guard system for Mandu. Use when checking layer dependencies,
  enforcing architecture rules, or validating file locations. Triggers on
  tasks involving architecture, layers, dependencies, or guard commands.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Guard

Mandu Guard는 아키텍처 규칙을 강제하는 시스템입니다.
레이어 간 의존성을 검사하고 위반을 실시간으로 감지합니다.

## Agent Workflow Contract

This skill is a Domain addendum. It must not replace `mandu-agent-workflow`.
Use it only after `mandu.agent.verify` reports guard diagnostics or `mandu.agent.plan` selects the guard domain.

Canonical workflow step: `verify -> repair`.

Preferred MCP tools:

| Step | Tools |
|------|-------|
| plan | `mandu.agent.plan` |
| verify | `mandu.agent.verify`, `mandu.guard.check`, `mandu.guard.explain` |
| repair | `mandu.agent.repair`, `mandu.guard.heal` |

Allowed file edits:

- Source files that violate import/layer rules
- `mandu.config.*` guard settings only when the plan explicitly changes policy
- Generated files are not direct-edit targets

Verification command:

```bash
mandu agent verify --changed --json --write
```

Common failures:

- Running low-level guard commands before reading the agent verify report
- Weakening guard config instead of fixing the import boundary
- Directly editing generated files to silence diagnostics

Repair path:

```bash
mandu agent repair --from .mandu/agent-verify.json --json
```

## When to Apply

Reference these guidelines when:
- Setting up architecture rules
- Checking layer dependencies
- Validating import paths
- Running architecture checks in CI
- Configuring guard presets

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Layer Rules | CRITICAL | `guard-layer-` |
| 2 | Presets | HIGH | `guard-preset-` |
| 3 | Validation | HIGH | `guard-validate-` |
| 4 | Configuration | MEDIUM | `guard-config-` |

## Quick Reference

### 1. Layer Rules (CRITICAL)

- `guard-layer-direction` - Dependencies flow downward only
- `guard-layer-violation` - Detect and fix layer violations
- `guard-layer-same-level` - Restrict same-layer imports

### 2. Presets (HIGH)

- `guard-preset-mandu` - FSD + Clean hybrid (default)
- `guard-preset-fsd` - Feature-Sliced Design
- `guard-preset-clean` - Clean Architecture
- `guard-preset-hexagonal` - Hexagonal/Ports & Adapters

### 3. Validation (HIGH)

- `guard-validate-import` - Check import path validity
- `guard-validate-location` - Check file location
- `guard-validate-naming` - Check naming conventions

### 4. Configuration (MEDIUM)

- `guard-config-rules` - Configure rule severity
- `guard-config-ignore` - Configure ignored paths

## Mandu Preset Layers

### Frontend (FSD)

```
app          # Top: app entry point
  ↓
pages        # Page components
  ↓
widgets      # Complex UI blocks
  ↓
features     # Feature units
  ↓
entities     # Business entities
  ↓
shared       # Shared utilities
```

### Backend (Clean)

```
api          # Top: API entry point
  ↓
application  # Use cases
  ↓
domain       # Business logic
  ↓
infra        # Infrastructure (DB, external APIs)
  ↓
core         # Core utilities
  ↓
shared       # Shared
```

## Validation Rules

| Rule ID | Description |
|---------|-------------|
| `LAYER_VIOLATION` | Layer dependency violation |
| `GENERATED_DIRECT_EDIT` | Direct edit of generated files |
| `WRONG_SLOT_LOCATION` | Wrong slot file location |
| `SLOT_NAMING` | Slot file naming rule violation |
| `FORBIDDEN_IMPORT` | Forbidden import (fs, child_process, etc.) |

## Low-Level CLI Commands

Use these only when `agent verify` or `agent repair` asks for guard-specific detail:

```bash
mandu agent verify --changed --json --write
mandu guard arch --ci
mandu guard arch --preset fsd
```

## How to Use

Read individual rule files for detailed explanations:

```
rules/guard-layer-direction.md
rules/guard-preset-mandu.md
```
