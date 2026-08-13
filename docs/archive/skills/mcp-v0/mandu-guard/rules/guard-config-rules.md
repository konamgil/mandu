---
title: Configure Rule Severity Levels
impact: MEDIUM
impactDescription: Customize guard behavior
tags: guard, config, rules
---

## Configure Rule Severity Levels

Set severity levels for each guard rule based on your project needs.

## Severity Levels

| Level | Behavior | Use Case |
|-------|----------|----------|
| `error` | Fails check, blocks CI | Critical violations |
| `warn` | Reports issue, continues | Gradual migration |
| `off` | Ignores rule | Not applicable to project |

## Configuration File

```typescript
// mandu.config.ts

export default {
  guard: {
    preset: "mandu",
    rules: {
      // Core rules
      "LAYER_VIOLATION": "error",      // Always enforce layers
      "GENERATED_DIRECT_EDIT": "error", // Protect generated files

      // Naming rules
      "SLOT_NAMING": "warn",           // Warn during migration
      "WRONG_SLOT_LOCATION": "error",

      // Security rules
      "FORBIDDEN_IMPORT": "error",     // Block dangerous imports
    },
  },
};
```

## Available Rules

| Rule ID | Default | Description |
|---------|---------|-------------|
| `LAYER_VIOLATION` | error | Layer dependency violation |
| `GENERATED_DIRECT_EDIT` | error | Direct edit of generated files |
| `WRONG_SLOT_LOCATION` | error | Slot file in wrong directory |
| `SLOT_NAMING` | error | Incorrect slot file naming |
| `FORBIDDEN_IMPORT` | warn | Importing fs, child_process, etc. in browser code |
| `CIRCULAR_DEPENDENCY` | warn | Circular import detected |
| `DEEP_IMPORT` | warn | Importing from nested paths instead of index |

## Ignoring Paths

```typescript
export default {
  guard: {
    ignore: [
      "**/test/**",       // Test files
      "**/*.test.ts",     // Test files
      "**/*.spec.ts",     // Spec files
      "**/mocks/**",      // Mock files
      "scripts/**",       // Build scripts
    ],
  },
};
```

## Per-File Override

```typescript
// src/features/legacy/index.ts

// @guard-disable LAYER_VIOLATION
import { oldHelper } from "@/entities/legacy";  // Allowed temporarily
// @guard-enable LAYER_VIOLATION
```

## Gradual Migration

```typescript
// Start with warnings for legacy code
{
  rules: {
    "LAYER_VIOLATION": "warn",  // Start with warn
    "SLOT_NAMING": "off",       // Fix later
  }
}

// After migration, enforce strictly
{
  rules: {
    "LAYER_VIOLATION": "error", // Now enforce
    "SLOT_NAMING": "error",     // Now enforce
  }
}
```
