---
title: Use page.tsx for Page Components
impact: CRITICAL
impactDescription: Required for routing to work
tags: routes, page, naming
---

## Use page.tsx for Page Components

Page components must be named `page.tsx`. This is how Mandu recognizes
which files should become routes.

**Incorrect (wrong filename):**

```
app/
├── about/
│   └── About.tsx      ❌ Won't be recognized
└── users/
    └── index.tsx      ❌ Won't be recognized
```

**Correct (page.tsx):**

```
app/
├── about/
│   └── page.tsx       ✅ → /about
└── users/
    └── page.tsx       ✅ → /users
```

## Page Component Structure

```tsx
// app/about/page.tsx

export default function AboutPage() {
  return (
    <div>
      <h1>About Us</h1>
    </div>
  );
}
```

## Special Files

| File | Purpose |
|------|---------|
| `page.tsx` | Page component |
| `layout.tsx` | Shared layout |
| `loading.tsx` | Loading UI |
| `error.tsx` | Error boundary |
| `route.ts` | API handler |
