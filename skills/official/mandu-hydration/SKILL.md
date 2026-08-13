---
name: mandu-hydration
description: Keep Mandu server rendering and client islands deterministic.
license: MPL-2.0
---

# Mandu Hydration

Use for islands, partials, client boundaries, or hydration diagnostics.

- Server pages remain server-owned; move interactive state into an island.
- Use explicit client-boundary metadata and serializable props.
- Never import a generated client artifact directly.
- Keep HTML, manifest, and client asset URLs pinned to one build generation.
- Treat missing client assets or hydration samples as failures when the route
  declares hydration.

Run the targeted hydration tests requested by the plan, then
`mandu.agent.verify --changed --json --write`.
