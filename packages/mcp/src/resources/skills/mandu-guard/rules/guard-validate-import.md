---
title: Validate Import Paths Against Architecture
impact: HIGH
impactDescription: Prevents architecture violations
tags: guard, validate, import
---

## Validate Import Paths Against Architecture

Check that all imports respect layer boundaries before committing code.

## Valid Import Examples

```typescript
// ✅ features/auth/login.ts → entities/user
import { User, createUser } from "@/entities/user";

// ✅ widgets/header/index.tsx → features/auth
import { useAuth } from "@/features/auth";

// ✅ pages/home/page.tsx → widgets/header
import { Header } from "@/widgets/header";

// ✅ Any layer → shared
import { formatDate } from "@/shared/lib/date";
```

## Invalid Import Examples

```typescript
// ❌ entities/user → features/auth (upward)
import { useAuth } from "@/features/auth";  // VIOLATION!

// ❌ shared/lib → entities/user (upward)
import { User } from "@/entities/user";  // VIOLATION!

// ❌ features/auth → features/cart (same layer cross-import)
import { CartItem } from "@/features/cart";  // VIOLATION!
```

## Checking Imports

### CLI

```bash
# Check single import
bunx mandu guard check-import \
  --from "src/features/auth/index.ts" \
  --import "@/entities/user"

# Check all imports in a file
bunx mandu guard check src/features/auth/index.ts
```

### MCP Tool

```typescript
// Check import validity
mandu_check_import({
  fromFile: "src/features/auth/index.ts",
  importPath: "@/entities/user"
})
// Returns: { valid: true, layer: "features", targetLayer: "entities" }
```

## Fixing Violations

| Pattern | Problem | Solution |
|---------|---------|----------|
| Upward import | Lower layer needs higher | Move shared logic down or use DI |
| Cross-feature import | Feature A uses Feature B | Extract to shared or create entity |
| Circular import | A → B → A | Restructure or use interfaces |

## CI Integration

```yaml
# .github/workflows/guard.yml
- name: Check Architecture
  run: bunx mandu guard arch --ci
```
