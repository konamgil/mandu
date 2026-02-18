# 04) Framework Playbooks

## React / Next.js

- Type props and component contracts explicitly.
- Prefer derived types from source-of-truth schemas.
- Model async UI state with discriminated unions.
- Keep server/client boundary types explicit in Next.

## Node / Express / Fastify / Nest

- Type request params/body/query and response shape.
- Avoid untyped middleware side effects.
- Centralize shared request-context types.
- In Nest, keep DTO, entity, and domain types distinct.

## Testing frameworks (Jest/E2E)

- Type fixtures/factories.
- Avoid `as` in tests except controlled setup boundaries.
- Validate serialization/deserialization behavior.

## Deno / React Native / Vue/Nuxt TS

- Respect platform module resolution and tsconfig constraints.
- Keep env/platform typings in dedicated modules.
- Add explicit ambient declarations only when unavoidable.
