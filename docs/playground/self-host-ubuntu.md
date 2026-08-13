---
title: Self-host playground on Ubuntu (Docker)
phase: 16.2
status: ready
audience: operator
related:
  - ./deployment.md
  - ./security.md
  - ../bun/phase-16-diagnostics/playground-runtime.md
updated: 2026-04-20
---

# Self-host the Mandu Playground on Ubuntu

This runbook ships a production-ready, vendor-neutral playground backend on
your own Ubuntu server. No Cloudflare, no Fly.io, no lock-in. Users submit
Mandu code at `https://playground.<your-domain>` and every run is isolated
in an ephemeral Docker container (`--network=none`, capped memory/CPU, drop
all capabilities, timed out at 30 s).

Prefer Cloudflare Sandboxes? See [`deployment.md`](./deployment.md) — that
path is ~$8/month at 30k runs/month but requires a CF account.

## What this gives you

- HTTPS on `playground.<your-domain>`, Let's Encrypt auto-provisioned
- Per-run Docker sandbox with hardened flags
- SSE event stream identical to the Cloudflare worker path
- Health endpoint at `/api/playground/health`
- JSON access logs, 10 MB rotating
- Systemd unit for boot-time startup

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Ubuntu | 22.04 LTS or newer | 24.04 recommended |
| Docker Engine | 24.x or newer | `docker --version` |
| Docker Compose | v2 (bundled with modern Docker) | `docker compose version` |
| Public DNS | A record for `playground.<domain>` | must resolve to host IP |
| Ports open | 80, 443 inbound | 80 used by Let's Encrypt HTTP-01 |
| Disk | ~2 GB for images + caddy_data volume | |
| RAM | 1 GB minimum, 2 GB recommended | |
| CPU | 1 vCPU works; 2 vCPUs smoother under load | |

A Hetzner CX22 (€4.50/month, 4 GB RAM, 40 GB SSD) or equivalent will
handle ~5k runs/day with headroom.

## Quickstart (5 minutes)

```bash
# 1. Clone the repo on your Ubuntu host
git clone https://github.com/konamgil/mandu.git
cd mandu/packages/playground-runner/deploy

# 2. Configure
cp .env.example .env
$EDITOR .env    # set PLAYGROUND_DOMAIN, PLAYGROUND_ORIGIN, ACME_EMAIL

# 3. Point DNS
#    Add an A record:  playground.<your-domain>  ->  <host-IP>
#    Verify:  dig +short playground.<your-domain>

# 4. Start the stack
docker compose up -d

# 5. Verify — the first request triggers ACME, second succeeds
curl -sf https://playground.<your-domain>/api/playground/health | jq .
# → { "ok": true, "mode": "local", "adapter": "docker", ... }
```

The playground is live.

## File layout

```
packages/playground-runner/
├── Dockerfile                     # outer container (bun runtime)
├── Dockerfile.sandbox             # optional: vendored sandbox image
├── src/
│   ├── docker-adapter.ts          # `docker run` wrapper (the hot path)
│   ├── adapter.ts                 # selectAdapter() wiring
│   └── local-server.ts            # Bun.serve HTTP entry
├── deploy/
│   ├── docker-compose.yml         # compose stack
│   ├── Caddyfile                  # reverse proxy + TLS
│   ├── .env.example               # operator knobs
│   └── systemd/playground.service # optional systemd unit
└── tests/docker-adapter.test.ts
```

## Architecture

```
 Public internet
  │  HTTPS (443)
  ▼
 ┌─────────────────┐
 │  caddy:2-alpine │  Let's Encrypt cert, access logs, security headers
 └────────┬────────┘
          │ reverse_proxy playground:8788 (flush_interval -1 for SSE)
          ▼
 ┌─────────────────────────────────────────┐
 │  mandu-playground (Bun runtime)         │
 │  bun run src/local-server.ts            │
 │  /var/run/docker.sock mounted           │
 └─────────────────────┬───────────────────┘
                       │ Bun.spawn(['docker', 'run', ...])
                       ▼
 ┌─────────────────────────────────────────┐
 │  oven/bun:1.3.14-slim  (per request)    │
 │  --rm --network=none --memory=256m      │
 │  --cpus=0.5 --pids-limit=128            │
 │  --user=65534:65534 --cap-drop=ALL      │
 │  --read-only  --tmpfs /tmp  --tmpfs /work │
 │  /work/index.ts ← user code (bind-mount) │
 └─────────────────────────────────────────┘
```

**Sibling-spawn, not Docker-in-Docker**: the outer container's
`/var/run/docker.sock` bind-mount means each `docker run` from inside
the outer container creates a sibling on the host's daemon. No nested
Docker daemon, no privileged mode, no kernel modules.

## Security envelope

Every per-request container inherits these flags (see
[`docker-adapter.ts`](../../packages/playground-runner/src/docker-adapter.ts)):

| Flag | Effect |
|---|---|
| `--rm` | container is deleted on exit (zero persistence) |
| `--network=none` | no network namespace; egress blocked at the kernel |
| `--memory=256m` | OOM-kill at 256 MiB; surfaced as `error.reason="oom"` |
| `--memory-swap=256m` | swap disabled (equal to memory cap) |
| `--cpus=0.5` | cgroup-enforced CPU quota; caps tight loops |
| `--pids-limit=128` | fork-bomb protection |
| `--read-only` | rootfs is immutable at runtime |
| `--tmpfs /tmp` | writable scratch in RAM |
| `--tmpfs /work` | writable user-code dir in RAM |
| `--user=65534:65534` | drop to `nobody:nogroup` — no root inside container |
| `--cap-drop=ALL` | drop every Linux capability |
| `--security-opt=no-new-privileges` | prevent setuid escalation |
| `--stop-timeout=30` | SIGTERM → SIGKILL after 30 s |

Wall-clock (`30 s`) + output cap (`64 KiB`) are enforced in the outer
container via `SECURITY_POLICY` in
[`src/security.ts`](../../packages/playground-runner/src/security.ts).
The adapter kills the inner container via `docker kill <name>` on timeout.

## Configuration reference

### `.env` keys

| Key | Required | Default | Purpose |
|---|---|---|---|
| `PLAYGROUND_DOMAIN` | yes | — | Public FQDN (`playground.example.com`) |
| `PLAYGROUND_ORIGIN` | yes | — | CORS origin for browser fetches |
| `ACME_EMAIL` | rec. | empty | Let's Encrypt renewal notices |
| `DOCKER_GID` | opt. | `999` | `getent group docker | cut -d: -f3` |
| `MANDU_DOCKER_SANDBOX_IMAGE` | opt. | `oven/bun:1.3.14-slim` | Per-run image |
| `TURNSTILE_SECRET` | opt. | empty | Reserved for parity with CF path |

### Environment variables (container side)

| Var | Default | Purpose |
|---|---|---|
| `MANDU_PLAYGROUND_ADAPTER` | `docker` | Selects `DockerSandboxAdapter` |
| `MANDU_PLAYGROUND_PORT` | `8788` | Bind port (internal only) |
| `MANDU_PLAYGROUND_HOST` | `0.0.0.0` | Bind addr (reachable by Caddy) |
| `MANDU_PLAYGROUND_CORS_ORIGIN` | — | CORS allowlist |
| `MANDU_DOCKER_SANDBOX_IMAGE` | `oven/bun:1.3.14-slim` | Per-run OCI image |
| `MANDU_DOCKER_WORK_DIR` | `/tmp/mandu-playground` | Stage dir for user code |

## Operations

### View logs

```bash
# Playground runner — what ran, when, exit codes
docker compose logs -f playground

# Caddy — HTTP access + ACME
docker compose logs -f caddy
docker compose exec caddy tail -f /data/access.log
```

### Update the playground runner

```bash
cd /opt/mandu-playground
git pull
docker compose build playground
docker compose up -d playground
# Caddy is untouched → no cert re-issue, no 503 during swap
```

### Rollback

```bash
git checkout <previous-sha>
docker compose up -d --build playground
```

### Graceful shutdown

```bash
docker compose down
# caddy volumes persist (cert + access log). Volumes are only removed
# with `docker compose down -v` — do NOT use -v unless you mean to
# re-issue the LE cert.
```

### Runtime healthcheck

```bash
# Liveness — also used by the `docker compose` healthcheck
curl -sf https://playground.<domain>/api/playground/health

# Expected:
# {
#   "ok": true,
#   "mode": "local",
#   "adapter": "docker",
#   "activeRuns": 0,
#   "limits": {
#     "wallClockMs": 30000,
#     "cpuBudgetMs": 15000,
#     "outputCapBytes": 65536,
#     "memoryMib": 256
#   }
# }
```

## Optional: systemd boot unit

If you want the stack to survive reboots without relying on Docker's
`restart: unless-stopped` (it starts on reboot but only after the daemon
is ready — some setups want an explicit ordering), install the unit:

```bash
sudo cp deploy/systemd/playground.service \
    /etc/systemd/system/mandu-playground.service
# adjust the WorkingDirectory to your clone path
sudo sed -i 's|/opt/mandu-playground|/your/path|g' \
    /etc/systemd/system/mandu-playground.service
sudo systemctl daemon-reload
sudo systemctl enable --now mandu-playground.service
sudo systemctl status mandu-playground
```

## Security hardening

### UFW firewall

```bash
sudo ufw default deny incoming
sudo ufw allow 22/tcp   # SSH — restrict to trusted IPs if possible
sudo ufw allow 80/tcp   # ACME HTTP-01
sudo ufw allow 443/tcp  # HTTPS + HTTP/3 if using 443/udp
sudo ufw allow 443/udp  # HTTP/3 only — remove if you don't use it
sudo ufw enable
```

### Docker bench check

```bash
docker run --rm --net host --pid host --userns host --cap-add audit_control \
    -e DOCKER_CONTENT_TRUST=$DOCKER_CONTENT_TRUST \
    -v /etc:/etc:ro \
    -v /usr/bin/containerd:/usr/bin/containerd:ro \
    -v /usr/bin/runc:/usr/bin/runc:ro \
    -v /usr/lib/systemd:/usr/lib/systemd:ro \
    -v /var/lib:/var/lib:ro \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    --label docker_bench_security \
    docker/docker-bench-security
```

Expected warnings you can ignore on a single-purpose host:

- `1.1.1 / 1.1.2` — host OS hardening (out of scope)
- `2.14` — live-restore — set `"live-restore": true` in
  `/etc/docker/daemon.json` if you want zero-downtime daemon updates

### nsjail / gVisor upgrade path

For extra sandbox strength beyond `--cap-drop=ALL` + `--user=nobody`:

- **gVisor** (recommended): install `runsc` and add
  `"default-runtime": "runsc"` to `/etc/docker/daemon.json`. The
  `DockerSandboxAdapter` argv is compatible — gVisor slots in at the
  runtime level. ~20% CPU overhead; syscall-filtering user-space kernel
  that neutralizes host kernel CVEs.
- **nsjail**: heavier to integrate, swap `bun run …` for
  `nsjail -Mo --disable_clone_newuser -- bun run …`. Not recommended
  as a first upgrade — gVisor is turnkey.

### Rate limiting

The default `caddy:2-alpine` image does not include the rate-limit
plugin. If you see abuse, build a custom Caddy image with
`github.com/mholt/caddy-ratelimit`:

```dockerfile
FROM caddy:builder AS builder
RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

Then uncomment the `rate_limit` block in `Caddyfile`.

Until then, protection relies on:
1. Per-run 30 s wall-clock + 256 MiB memory cap
2. `--pids-limit=128` inside the sandbox
3. CORS origin pinning (browser-visited origins only)

## Observability

### Prometheus scraping (Phase 17 + 18.ψ)

The Mandu core exposes `/_mandu/metrics` when `MANDU_METRICS=1` is set
in the outer container. The self-host stack doesn't enable this by
default — add to `docker-compose.yml` under `playground.environment`:

```yaml
- MANDU_METRICS=1
```

Then scrape from Prometheus:

```yaml
scrape_configs:
  - job_name: mandu-playground
    scheme: https
    static_configs:
      - targets: ['playground.example.com']
    metrics_path: /_mandu/metrics
```

### Log aggregation

Caddy emits JSON access logs. Pipe to Loki / Datadog / CloudWatch via
the standard json-file Docker logging driver already configured in
`docker-compose.yml`. To point a Promtail / Vector / fluent-bit sidecar
at the log volume:

```yaml
# docker-compose.override.yml
services:
  promtail:
    image: grafana/promtail:latest
    volumes:
      - caddy_data:/var/log/caddy:ro
      - ./promtail-config.yaml:/etc/promtail/config.yml:ro
    command: -config.file=/etc/promtail/config.yml
```

## Abuse handling

### Detect abuse

```bash
# Top 20 IPs by request count in the last 100k lines
docker compose exec caddy \
    awk '{print $1}' /data/access.log | sort | uniq -c | sort -rn | head -20

# Failed runs (error events in playground logs)
docker compose logs playground --since 1h | grep '"type":"error"'
```

### Ban an IP at Caddy

Add to the Caddyfile site block, then `docker compose reload caddy`:

```
@banned remote_ip 1.2.3.4 5.6.7.8
respond @banned "rate limited" 429
```

### Turnstile integration

The `DockerSandboxAdapter` does not yet gate runs on Turnstile; the
self-host stack trusts the ingress at Caddy. To add a cookie-based
challenge:

1. Build a challenge endpoint in your front-end that verifies Turnstile.
2. On success, set a signed session cookie that the playground UI
   includes on `POST /api/playground/run`.
3. Add a Caddy `@missing_cookie` matcher that respond 401 for requests
   without the cookie.

Full flow lives in `docs/playground/security.md §Abuse`.

## Cost estimate

| Provider | Tier | RAM / CPU | Monthly | Runs/day headroom |
|---|---|---|---|---|
| Hetzner CX22 | shared vCPU | 4 GB / 2 vCPU | €4.50 | ~10k |
| DigitalOcean | Basic Regular | 2 GB / 2 vCPU | $18 | ~5k |
| OVH | VPS Starter | 2 GB / 1 vCPU | €3.50 | ~3k |
| Your own hardware | Raspberry Pi 5 | 8 GB / 4 vCPU | 0 | ~10k |

Bandwidth: ~20 MB per 1 k runs (assuming avg 20 KB SSE payload). A
2 TB/month cap at €4.50 is 100M runs on paper — in practice the 30 s
wall-clock + 256 MiB memory cap caps you at ~3 k concurrent runs
before queueing degrades experience. If you need more, horizontal-scale
by running N copies behind a load balancer; each copy is stateless.

## Troubleshooting

### `Error: self-signed certificate`

DNS hasn't propagated yet → Caddy is using the ACME staging CA as a
fallback. Wait 5 min, then `docker compose restart caddy`.

### `docker: Got permission denied while trying to connect to the Docker daemon`

The outer container's `bun` user isn't in the host's `docker` group.
Check `DOCKER_GID` in `.env`:

```bash
getent group docker | cut -d: -f3
```

Set that value, then `docker compose up -d --force-recreate playground`.

### Timeouts on every run

Likely the sandbox image isn't pulled yet. First run pulls
`oven/bun:1.3.14-slim` (~110 MB) which can time out on slow links.
Pre-pull:

```bash
docker pull oven/bun:1.3.14-slim
```

### Container creation fails with "No space left on device"

```bash
docker system df
docker system prune -a --volumes    # destructive — reads docs first
```

The `--rm` flag keeps the playground clean, but if your host runs other
services you may need to bump the Docker dm-thinpool or switch to
overlay2 with a larger disk.

## See also

- [`deployment.md`](./deployment.md) — Cloudflare Sandboxes path
- [`security.md`](./security.md) — full threat model
- [`../bun/phase-16-diagnostics/playground-runtime.md`](../bun/phase-16-diagnostics/playground-runtime.md) — R0 research
- Mandu GitHub issue [#201](https://github.com/konamgil/mandu/issues/201) — Phase 16.2 tracker
