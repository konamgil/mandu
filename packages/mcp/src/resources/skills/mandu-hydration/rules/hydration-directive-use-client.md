---
title: Add "use client" Directive for Client Components
impact: CRITICAL
impactDescription: Required for client-side interactivity
tags: hydration, client, directive
---

## Add "use client" Directive for Client Components

Client components must have `"use client"` directive at the top of the file.

**Incorrect (missing directive):**

```tsx
// app/counter/client.tsx

import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);  // ❌ Will error
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

**Correct (with directive):**

```tsx
// app/counter/client.tsx

"use client";

import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);  // ✅ Works
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

## When to Use "use client"

Use the directive when your component:
- Uses React hooks (useState, useEffect, useRef, etc.)
- Has event handlers (onClick, onChange, etc.)
- Uses browser-only APIs (window, document, localStorage)
- Needs client-side interactivity

## File Naming Convention

```
app/
├── counter/
│   ├── page.tsx      # Server component (no directive needed)
│   └── client.tsx    # Client component ("use client" required)
```
