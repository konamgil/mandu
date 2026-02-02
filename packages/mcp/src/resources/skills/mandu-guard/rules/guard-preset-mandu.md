---
title: Use Mandu Preset for Full-Stack Projects
impact: HIGH
impactDescription: Recommended architecture preset
tags: guard, preset, architecture
---

## Use Mandu Preset for Full-Stack Projects

The Mandu preset combines FSD (Feature-Sliced Design) for frontend with Clean Architecture for backend.

## Preset Selection Guide

| Preset | Use Case | Frontend | Backend |
|--------|----------|----------|---------|
| `mandu` | Full-stack projects | FSD | Clean |
| `fsd` | Frontend-focused | FSD | - |
| `clean` | Backend-focused | - | Clean |
| `hexagonal` | Domain-heavy | - | Hexagonal |
| `atomic` | Component libraries | Atomic | - |

## Mandu Preset Structure

```
src/
├── app/                    # App entry, routing
├── pages/                  # Page components
├── widgets/                # Complex UI blocks
├── features/               # Feature modules
│   ├── auth/
│   ├── cart/
│   └── search/
├── entities/               # Business entities
│   ├── user/
│   ├── product/
│   └── order/
├── shared/                 # Shared utilities
│   ├── ui/                 # UI components
│   ├── lib/                # Utility functions
│   ├── api/                # API client
│   └── config/             # Configuration
└── api/                    # Backend
    ├── application/        # Use cases
    ├── domain/             # Business logic
    ├── infra/              # Database, external
    └── core/               # Core utilities
```

## Configuration

```typescript
// mandu.config.ts

export default {
  guard: {
    preset: "mandu",  // Use mandu preset
    rules: {
      "LAYER_VIOLATION": "error",
      "SLOT_NAMING": "warn",
    },
    ignore: [
      "**/test/**",
      "**/*.test.ts",
      "**/*.spec.ts",
    ],
  },
};
```

## Switching Presets

```bash
# Use FSD only (frontend project)
bunx mandu guard arch --preset fsd

# Use Clean only (backend project)
bunx mandu guard arch --preset clean

# Use Mandu (full-stack, default)
bunx mandu guard arch --preset mandu
```
