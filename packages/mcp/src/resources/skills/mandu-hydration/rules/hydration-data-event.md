---
title: Use useIslandEvent for Island Communication
impact: MEDIUM
impactDescription: Enables Island-to-Island data flow
tags: hydration, event, communication
---

## Use useIslandEvent for Island Communication

Islands are isolated by default. Use `useIslandEvent` to communicate between them.

**Incorrect (shared global state):**

```tsx
// ❌ Don't use global variables for Island communication
let globalCount = 0;

// Island A
export function CounterIsland() {
  const [count, setCount] = useState(globalCount);
  // This won't sync with other Islands
}
```

**Correct (useIslandEvent):**

```tsx
// Island A: Counter (emits updates)
"use client";

import { useState } from "react";
import { useIslandEvent } from "@mandujs/core/client";

export function CounterIsland() {
  const [count, setCount] = useState(0);
  const { emit } = useIslandEvent<{ count: number }>("counter-update");

  const increment = () => {
    const newCount = count + 1;
    setCount(newCount);
    emit({ count: newCount });  // Notify other Islands
  };

  return <button onClick={increment}>Count: {count}</button>;
}
```

```tsx
// Island B: Display (receives updates)
"use client";

import { useState } from "react";
import { useIslandEvent } from "@mandujs/core/client";

export function DisplayIsland() {
  const [lastCount, setLastCount] = useState(0);

  useIslandEvent<{ count: number }>("counter-update", (data) => {
    setLastCount(data.count);  // React to counter updates
  });

  return <p>Last count received: {lastCount}</p>;
}
```

## API Reference

```typescript
// Emit events
const { emit } = useIslandEvent<T>(eventName);
emit(data);

// Listen to events
useIslandEvent<T>(eventName, (data) => {
  // Handle received data
});

// Both emit and listen
const { emit } = useIslandEvent<T>(eventName, (data) => {
  // Handle received data
});
emit(otherData);
```

## Common Patterns

### Cart Updates

```tsx
// Product Island
emit({ action: "add", productId: 123 });

// Cart Island
useIslandEvent("cart-update", ({ action, productId }) => {
  if (action === "add") addToCart(productId);
});
```

### Form Validation

```tsx
// Form Field Island
emit({ field: "email", valid: true, value: "user@example.com" });

// Submit Button Island
useIslandEvent("field-change", ({ field, valid }) => {
  updateFieldStatus(field, valid);
});
```
