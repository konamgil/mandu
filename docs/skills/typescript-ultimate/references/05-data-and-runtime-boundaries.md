# 05) Data and Runtime Boundaries

## DB/ORM (TypeORM and similar)

- Separate persistence types from domain types.
- Never leak ORM entity types across service boundaries.
- Use repository return types that match domain contracts.

## JSON and external payloads

- Treat parsed JSON as `unknown`.
- Parse -> validate -> narrow.
- Use `Record<string, unknown>` instead of `any` for generic JSON objects.

## Config and env

- Define typed config schema once.
- Fail fast at startup on invalid config.
- Expose readonly config object to app modules.

## Runtime safety

- Use nullish coalescing (`??`) over `||` for defaults.
- Use optional chaining (`?.`) where absence is expected.
- Guard all edge IO points (network, file, message queues, webhooks).
