---
status: current
audience: application operators and hosting adapters
---

# Mandu production artifact contract

Mandu stops at a reproducible Bun application artifact. It does not own cloud
credentials, provider configuration, remote rollout, or deployment status.

## Produce and verify

```bash
bun install --frozen-lockfile
bunx mandu check
bunx mandu build
bunx mandu start
```

`mandu start` is the local acceptance test for the same production artifact.
It refuses a missing, development, stale, or invalid bundle manifest.

## Required runtime inputs

Keep these paths together at the same project-relative locations:

| Input | Contract |
|---|---|
| `.mandu/manifest.json` | Production bundle manifest and active build generation |
| `.mandu/client/**` | Immutable client runtime, island, CSS, and shared chunks |
| `.mandu/prerendered/**` | Optional prerendered output when configured |
| `app/**`, `src/**`, `spec/**` | Server route and application modules loaded by Bun |
| `mandu.config.*` | Runtime and route configuration |
| `public/**` | User-owned static assets, when present |
| `package.json`, `bun.lock`, `node_modules/**` | Frozen Bun dependency graph |

The artifact is valid only as a unit. Do not copy a manifest from one build
with client files from another generation.

## Runtime contract

- Runtime: Bun `>=1.3.12`; official build images use Bun 1.3.14.
- Entrypoint: `bunx mandu start`.
- Port: `PORT`, falling back to `mandu.config` and then `3333`.
- Environment: set `NODE_ENV=production`; provide secrets through the hosting
  platform's environment or secret manager.
- Health checks: probe an application-owned route after the server announces
  its listening address.
- Shutdown: the process handles `SIGINT` and `SIGTERM` and closes the server.

## Provider-neutral container example

```dockerfile
FROM oven/bun:1.3.14 AS application
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bunx mandu check && bunx mandu build

ENV NODE_ENV=production
ENV PORT=3333
EXPOSE 3333
CMD ["bunx", "mandu", "start"]
```

Build and run it with ordinary container tooling:

```bash
docker build -t my-mandu-app .
docker run --rm -p 3333:3333 --env-file .env.production my-mandu-app
```

Provider adapters may consume this contract, but they live outside the stable
Mandu CLI and must not be required by `create`, `dev`, `build`, `start`,
`check`, or `agent`.
