<p align="center">
  <img src="../../mandu_only_simbol.png" alt="Mandu" width="200" />
</p>

<h1 align="center">@mandujs/core</h1>

<p align="center">
  <strong>Mandu Framework Core</strong><br/>
  Spec, Generator, Guard, Runtime, Filling
</p>

<p align="center">
  English | <a href="./README.ko.md"><strong>한국어</strong></a>
</p>

## Installation

```bash
bun add @mandujs/core
```

> Typically used through `@mandujs/cli`. Direct usage is for advanced use cases.

## Module Structure

```
@mandujs/core
├── spec/      # Spec schema and loading
├── generator/ # Code generation
├── guard/     # Architecture checking and auto-correction
├── runtime/   # Server and router
└── report/    # Guard report generation
```

## Spec Module

Route manifest schema definition and loading.

```typescript
import { loadManifest, RoutesManifest, RouteSpec } from "@mandujs/core";

// Load and validate manifest
const result = await loadManifest("spec/routes.manifest.json");

if (result.success && result.data) {
  const manifest: RoutesManifest = result.data;
  manifest.routes.forEach((route: RouteSpec) => {
    console.log(route.id, route.pattern, route.kind);
  });
}
```

### Lock File

```typescript
import { writeLock, readLock } from "@mandujs/core";

// Write lock file
const lock = await writeLock("spec/spec.lock.json", manifest);
console.log(lock.routesHash);

// Read lock file
const existing = await readLock("spec/spec.lock.json");
```

## Generator Module

Spec-based code generation.

```typescript
import { generateRoutes, GenerateResult } from "@mandujs/core";

const result: GenerateResult = await generateRoutes(manifest, "./");

console.log("Created:", result.created);
console.log("Skipped:", result.skipped);  // Existing slot files
```

### Template Functions

```typescript
import {
  generateApiHandler,
  generateApiHandlerWithSlot,
  generateSlotLogic,
  generatePageComponent
} from "@mandujs/core";

// Generate API handler
const code = generateApiHandler(route);

// API handler with slot
const codeWithSlot = generateApiHandlerWithSlot(route);

// Slot logic file
const slotCode = generateSlotLogic(route);
```

## Guard Module

Architecture rule checking and auto-correction.

```typescript
import {
  runGuardCheck,
  runAutoCorrect,
  GuardResult,
  GuardViolation
} from "@mandujs/core";

// Run check
const result: GuardResult = await runGuardCheck(manifest, "./");

if (!result.passed) {
  result.violations.forEach((v: GuardViolation) => {
    console.log(`${v.rule}: ${v.message}`);
  });

  // Run auto-correction
  const corrected = await runAutoCorrect(result.violations, manifest, "./");
  console.log("Fixed:", corrected.steps);
  console.log("Remaining violations:", corrected.remainingViolations);
}
```

### Guard Rules

| Rule ID | Description | Auto-correctable |
|---------|-------------|------------------|
| `SPEC_HASH_MISMATCH` | Spec and lock hash mismatch | ✅ |
| `GENERATED_MANUAL_EDIT` | Manual edit to generated file | ✅ |
| `HANDLER_NOT_FOUND` | Handler file not found | ❌ |
| `COMPONENT_NOT_FOUND` | Component file not found | ❌ |
| `SLOT_NOT_FOUND` | Slot file not found | ✅ |

## Runtime Module

Server startup and routing.

```typescript
import {
  startServer,
  registerApiHandler,
  registerPageLoader
} from "@mandujs/core";

// Register API handler
registerApiHandler("getUsers", async (req) => {
  return { users: [] };
});

// Register page loader
registerPageLoader("homePage", () => import("./pages/Home"));

// Start server
const server = startServer(manifest, { port: 3000 });

// Stop
server.stop();
```

## Report Module

Guard result report generation.

```typescript
import { buildGuardReport } from "@mandujs/core";

const report = buildGuardReport(guardResult, lockPath);
console.log(report);  // Formatted text report
```

## Types

```typescript
import type {
  RoutesManifest,
  RouteSpec,
  RouteKind,
  SpecLock,
  GuardResult,
  GuardViolation,
  GenerateResult,
  AutoCorrectResult,
} from "@mandujs/core";
```

## Requirements

- Bun >= 1.0.0
- React >= 18.0.0
- Zod >= 3.0.0

## Related Packages

- [@mandujs/cli](https://www.npmjs.com/package/@mandujs/cli) - CLI tool

## License

MIT
