---
title: Dependencies Must Flow Downward Only
impact: CRITICAL
impactDescription: Core architecture principle
tags: guard, layer, dependency
---

## Dependencies Must Flow Downward Only

In layered architecture, imports must always flow from higher to lower layers.

**Incorrect (upward dependency):**

```typescript
// ❌ entities/user/index.ts importing from features (higher layer)
import { useAuth } from "@/features/auth";

export function User() {
  const { isLoggedIn } = useAuth();  // VIOLATION!
  // ...
}
```

**Correct (downward dependency):**

```typescript
// ✅ features/auth/index.ts importing from entities (lower layer)
import { User } from "@/entities/user";

export function useAuth() {
  const user = getCurrentUser();  // Uses entity
  return { user, isLoggedIn: !!user };
}
```

## Layer Hierarchy (Mandu Preset)

### Frontend Layers (top to bottom)

```
app         → Can import: pages, widgets, features, entities, shared
pages       → Can import: widgets, features, entities, shared
widgets     → Can import: features, entities, shared
features    → Can import: entities, shared
entities    → Can import: shared
shared      → Can import: (nothing above)
```

### Backend Layers (top to bottom)

```
api         → Can import: application, domain, infra, core, shared
application → Can import: domain, infra, core, shared
domain      → Can import: core, shared
infra       → Can import: core, shared
core        → Can import: shared
shared      → Can import: (nothing above)
```

## Common Violations

| Violation | Fix |
|-----------|-----|
| Entity imports Feature | Move shared logic to Entity or Shared |
| Domain imports API | Use dependency injection |
| Shared imports Feature | Extract to Shared or keep in Feature |

## Checking Dependencies

```bash
# Check all architecture rules
bunx mandu guard arch

# Check specific file
bunx mandu guard check src/entities/user/index.ts
```
