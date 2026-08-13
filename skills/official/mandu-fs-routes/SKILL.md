---
name: mandu-fs-routes
description: Author Mandu pages and APIs through the app directory convention.
license: MPL-2.0
---

# Mandu FS Routes

Use after `mandu.agent.plan` selects the route or API domain.

- `app/page.tsx` maps to `/`.
- `app/<segment>/page.tsx` maps to a page route.
- `app/api/<segment>/route.ts` maps to an API route.
- `[id]`, `[...slug]`, and `[[...slug]]` define dynamic segments.
- Layouts use `layout.tsx`; never edit generated route manifests directly.

Inspect the nearest existing route before writing. Prefer
`mandu.agent.apply`; otherwise keep direct edits inside the planned `app/**`
scope. Verify with `mandu.agent.verify --changed --json --write`.
