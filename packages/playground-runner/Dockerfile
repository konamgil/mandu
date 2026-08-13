# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Mandu Playground Runner — outer container
# ---------------------------------------------------------------------------
# This is the LONG-LIVED container that hosts `bun run src/local-server.ts`.
# It receives requests from the Caddy reverse proxy at
# `playground.<your-domain>:8788` and delegates each run to an ephemeral
# user-code container (see `src/docker-adapter.ts`).
#
# **Sibling-spawn model**: the outer container bind-mounts
# `/var/run/docker.sock`, which lets `bun` invoke `docker run …` that talks
# directly to the **host** Docker daemon. User-code containers are siblings
# of this one, not children (no Docker-in-Docker).
#
# Build:
#   docker build -t mandu-playground:latest packages/playground-runner
#
# Run (stand-alone, for smoke tests — operators should use docker-compose.yml):
#   docker run --rm -p 8788:8788 \
#     -v /var/run/docker.sock:/var/run/docker.sock \
#     -v /tmp/mandu-playground:/tmp/mandu-playground \
#     -e MANDU_PLAYGROUND_ADAPTER=docker \
#     -e MANDU_PLAYGROUND_HOST=0.0.0.0 \
#     mandu-playground:latest
# ---------------------------------------------------------------------------

# ============================================================================
# Stage 1: build — install deps, copy sources. Kept separate from the
# runtime stage to strip dev tooling out of the final image.
# ============================================================================
FROM oven/bun:1.3.14-slim AS build

WORKDIR /app

# Copy only the package manifest first so `bun install` can be cached
# across source changes.
COPY package.json ./
# bun.lock is committed at the workspace root. We copy the sibling
# package's manifest alone and let `bun install` resolve dev deps against
# the container-local lockfile. (The outer container is self-contained —
# it does NOT need the entire monorepo.)
COPY tsconfig.json ./

# The package is `private: true` in the workspace. Ignore workspace-link
# errors and install what's in its own package.json manifest. Production
# mode drops devDependencies from the image.
RUN bun install --production --no-save || \
    bun install --production || true

# Copy source last so source edits don't bust the deps layer.
COPY src ./src

# ============================================================================
# Stage 2: runtime — minimal image carrying only the bun runtime + app.
# ============================================================================
FROM oven/bun:1.3.14-slim AS runtime

# Install the Docker CLI so `DockerSandboxAdapter` can shell out to
# `docker run …`. The **daemon** is NOT installed — we talk to the host's
# daemon over the bind-mounted socket.
#
# `docker-cli` is in the Debian repos as part of `docker.io` on most
# Ubuntu hosts, but for a slim image we grab just the static CLI binary
# from Docker's official apt repo to avoid pulling in container tooling
# we don't need.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc; \
    chmod a+r /etc/apt/keyrings/docker.asc; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo ${VERSION_CODENAME}) stable" > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends docker-ce-cli; \
    rm -rf /var/lib/apt/lists/*; \
    apt-get purge -y --auto-remove curl gnupg

WORKDIR /app

# Copy app artifacts from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Stage directory for user-code files (bind-mounted into sandbox
# containers as /work/index.ts). Create with mode 0700 owned by `bun`.
# Compose mounts the host's `/tmp/mandu-playground` onto the same path
# so sandbox containers can see the file.
RUN mkdir -p /tmp/mandu-playground && chown -R bun:bun /tmp/mandu-playground /app

# oven/bun ships a non-root `bun` user (uid 1000). We add it to the
# `docker` group at runtime via the compose GROUP_ID build-arg (see
# docker-compose.yml). Running as root would work but violates the
# least-privilege principle for the outer container.
#
# NOTE: the sandbox containers themselves drop further to uid 65534
# (nobody) — this `bun` user only applies to the outer process that
# *invokes* docker.
USER bun

EXPOSE 8788

ENV MANDU_PLAYGROUND_ADAPTER=docker
ENV MANDU_PLAYGROUND_PORT=8788
ENV MANDU_PLAYGROUND_HOST=0.0.0.0
# Default sandbox image — operators may pin a local build via compose
# env override.
ENV MANDU_DOCKER_SANDBOX_IMAGE=oven/bun:1.3.14-slim
# Stage dir shared with the host for bind-mounting user code.
ENV MANDU_DOCKER_WORK_DIR=/tmp/mandu-playground

# Basic healthcheck — hit the /health endpoint so docker / compose /
# systemd can observe liveness. Uses `bun` to avoid pulling in `curl`
# at runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "await fetch('http://127.0.0.1:8788/api/playground/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/local-server.ts"]
