# 03) API and Schema Typing

## Contract-first

- Define endpoint contracts in one place (path, method, params, body, response, errors).
- Generate types from OpenAPI when available; avoid manual drift.
- Keep transport DTO and domain model separated.

## Boundary flow

1. Input arrives as `unknown`
2. Validate/parse into DTO
3. Map DTO -> domain type
4. Execute logic
5. Map domain -> response DTO

## Request typing pattern

- Route/method keyed config type.
- Helper types for params/body/response extraction.
- Strongly typed client wrappers.

## Error model

- Use discriminated unions for API errors:
  - validation
  - auth
  - permission
  - not-found
  - conflict
  - internal

## OpenAPI guidance

- Keep generated types isolated in one module.
- Never edit generated files directly.
- Add small handwritten adapters around generated types.
