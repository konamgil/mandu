# Runtime Contracts

작성일: 2026-05-21

이 문서는 `loader`, `action`, `filling`, `contract`가 각각 무엇을 책임지는지 고정한다. 네 개념을 섞으면 route module이 커지고, MCP/Guard/ATE가 변경 범위를 안전하게 판단하기 어렵다.

## Responsibility Matrix

| Surface | Owns | Must not own | Primary types |
|---|---|---|---|
| loader | server-side read for a page or layout before render | mutation, response schema, route dispatch | `Loader`, `RouteDataLoader`, `LoaderResult` |
| action | named mutation or interaction on a filling route | page render data contract, OpenAPI schema source | `ActionHandler`, `MutationAction` |
| filling | route pipeline: HTTP handlers, loader, actions, middleware, cache, render mode | canonical request/response schema definition | `ManduFilling`, `RouteFilling` |
| contract | request/response schema, type inference, OpenAPI/client assumptions | business mutation, data fetching side effects | `ContractDefinition`, `ContractInstance`, `ApiContract` |

## Loader

A loader reads data for SSR and may short-circuit with a `Response`.

- Page loaders may return or throw `redirect()`/`notFound()` responses.
- Layout loaders provide shared layout data and must not short-circuit the page render.
- Loader cache metadata belongs to the loader/filling boundary, not to the contract schema.

## Action

An action is a named mutation handler registered on a filling.

- It is dispatched from non-GET requests via `_action`.
- It returns an HTTP `Response`.
- If a loader exists, the filling may revalidate loader data after the action.
- It must validate user input directly or through a contract-backed handler before mutating state.

## Filling

A filling is the executable route pipeline.

- It owns HTTP methods, lifecycle hooks, middleware, WebSocket handlers, loader/action registration, cache options, and render mode.
- It may reference a contract, but it is not itself the source of truth for schema compatibility.
- Agent edits to filling files should run Guard/contract consistency checks plus targeted route tests.

## Contract

A contract is the schema and type boundary for an API.

- It owns request, response, status code, normalization, client-safe exposure, and OpenAPI assumptions.
- It should be changed before generated slots/handlers are changed.
- Generated contract artifacts should not be edited by hand; use resource/contract generation flows instead.

## Agent Rules

- Route/API generation starts from contract or MCP route tools when available.
- Direct edits to generated contract/client/type artifacts are treated as unsafe unless the task explicitly asks for generated output repair.
- A change that touches both contract and filling must run contract validation and targeted route tests.
- A loader/action-only change does not require OpenAPI regeneration unless the request/response schema changed.
