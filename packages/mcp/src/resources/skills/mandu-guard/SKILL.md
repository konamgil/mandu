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

## CLI Commands

```bash
# Architecture check
bunx mandu guard arch

# Watch mode
bunx mandu guard arch --watch

# CI mode (exit 1 on violation)
bunx mandu guard arch --ci

# Use specific preset
bunx mandu guard arch --preset fsd
```

## How to Use

Read individual rule files for detailed explanations:

```
rules/guard-layer-direction.md
rules/guard-preset-mandu.md
```
