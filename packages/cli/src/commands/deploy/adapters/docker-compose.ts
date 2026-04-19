/**
 * Docker Compose adapter.
 *
 * Emits a `docker-compose.yml` that wires the Mandu app container
 * produced by the `docker` adapter's Dockerfile alongside a Postgres
 * sidecar (Phase 4c DB integration) and an optional Redis sidecar.
 *
 * The adapter reuses the Docker adapter's `Dockerfile` via
 * {@link renderDockerfile} — running `mandu deploy --target=docker`
 * before this target is recommended but not strictly required: this
 * adapter will emit the Dockerfile itself if absent.
 *
 * @module cli/commands/deploy/adapters/docker-compose
 */
import path from "node:path";
import { CLI_ERROR_CODES } from "../../../errors/codes";
import { writeArtifact } from "../artifact-writer";
import { renderDockerfile } from "./docker";
import type {
  AdapterArtifact,
  AdapterCheckResult,
  AdapterIssue,
  DeployAdapter,
  DeployOptions,
  ProjectContext,
} from "../types";

const DEFAULT_PORT = 3333;
const DEFAULT_POSTGRES_TAG = "16-alpine";
const DEFAULT_REDIS_TAG = "7-alpine";

// ---------------------------------------------------------------------
// docker-compose.yml template
// ---------------------------------------------------------------------

export interface ComposeOptions {
  projectName: string;
  appPort?: number;
  /** Include a Postgres service (default true). */
  includePostgres?: boolean;
  /** Include a Redis service (default false). */
  includeRedis?: boolean;
  postgresImageTag?: string;
  redisImageTag?: string;
  /**
   * Postgres database name. Exposed to the app as DATABASE_URL.
   * Default: derived from projectName.
   */
  postgresDatabase?: string;
}

export function renderDockerCompose(options: ComposeOptions): string {
  if (!/^[a-z0-9-]{1,48}$/.test(options.projectName)) {
    throw new Error(
      `renderDockerCompose: projectName "${options.projectName}" must match /^[a-z0-9-]{1,48}$/.`
    );
  }
  const appPort = options.appPort ?? DEFAULT_PORT;
  const includePg = options.includePostgres !== false;
  const includeRedis = options.includeRedis === true;
  const pgImage = options.postgresImageTag ?? DEFAULT_POSTGRES_TAG;
  const redisImage = options.redisImageTag ?? DEFAULT_REDIS_TAG;
  const pgDb =
    options.postgresDatabase ?? options.projectName.replace(/-/g, "_");

  const services: string[] = [];

  // ----- app service -----
  services.push(
    [
      "  app:",
      "    build:",
      "      context: .",
      "      dockerfile: Dockerfile",
      "      target: runtime",
      `    image: ${options.projectName}:latest`,
      `    container_name: ${options.projectName}-app`,
      "    restart: unless-stopped",
      "    ports:",
      `      - "\${APP_PORT:-${appPort}}:${appPort}"`,
      "    environment:",
      "      NODE_ENV: production",
      `      PORT: "${appPort}"`,
      ...(includePg
        ? [
            "      DATABASE_URL: \"postgres://mandu:${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}@postgres:5432/" +
              pgDb +
              "\"",
          ]
        : []),
      ...(includeRedis
        ? ['      REDIS_URL: "redis://redis:6379"']
        : []),
      ...(includePg || includeRedis
        ? [
            "    depends_on:",
            ...(includePg
              ? [
                  "      postgres:",
                  "        condition: service_healthy",
                ]
              : []),
            ...(includeRedis
              ? [
                  "      redis:",
                  "        condition: service_healthy",
                ]
              : []),
          ]
        : []),
      "    healthcheck:",
      `      test: [\"CMD-SHELL\", \"wget -qO- http://127.0.0.1:${appPort}/ || exit 1\"]`,
      "      interval: 30s",
      "      timeout: 5s",
      "      retries: 3",
    ].join("\n")
  );

  if (includePg) {
    services.push(
      [
        "  postgres:",
        `    image: postgres:${pgImage}`,
        `    container_name: ${options.projectName}-postgres`,
        "    restart: unless-stopped",
        "    environment:",
        "      POSTGRES_USER: mandu",
        '      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}"',
        `      POSTGRES_DB: ${pgDb}`,
        "    volumes:",
        "      - postgres-data:/var/lib/postgresql/data",
        "    healthcheck:",
        '      test: ["CMD-SHELL", "pg_isready -U mandu"]',
        "      interval: 10s",
        "      timeout: 5s",
        "      retries: 5",
      ].join("\n")
    );
  }

  if (includeRedis) {
    services.push(
      [
        "  redis:",
        `    image: redis:${redisImage}`,
        `    container_name: ${options.projectName}-redis`,
        "    restart: unless-stopped",
        "    volumes:",
        "      - redis-data:/data",
        "    healthcheck:",
        '      test: ["CMD", "redis-cli", "ping"]',
        "      interval: 10s",
        "      timeout: 5s",
        "      retries: 5",
      ].join("\n")
    );
  }

  const volumes: string[] = [];
  if (includePg) volumes.push("  postgres-data:");
  if (includeRedis) volumes.push("  redis-data:");

  const document = [
    `# Generated by \`mandu deploy --target=docker-compose\`.`,
    `# Copy .env.example → .env and set POSTGRES_PASSWORD before bringing`,
    `# the stack up: \`docker compose up -d\`.`,
    "",
    `name: ${options.projectName}`,
    "",
    "services:",
    services.join("\n\n"),
  ];

  if (volumes.length > 0) {
    document.push("", "volumes:", volumes.join("\n"));
  }

  return document.join("\n") + "\n";
}

// ---------------------------------------------------------------------
// .env.example template
// ---------------------------------------------------------------------

export function renderEnvExample(includePostgres: boolean, includeRedis: boolean): string {
  const lines = [
    "# Copy to .env and set the values below.",
    "# Never commit .env — it is ignored by default (.gitignore, .dockerignore).",
    "",
    "APP_PORT=3333",
  ];
  if (includePostgres) {
    lines.push(
      "",
      "# Postgres — required when the compose stack includes the postgres service.",
      "POSTGRES_PASSWORD=change-me-please"
    );
  }
  if (includeRedis) {
    lines.push(
      "",
      "# Redis — only set when using a password-protected Redis."
    );
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------

export const dockerComposeAdapter: DeployAdapter = {
  name: "Docker Compose",
  target: "docker-compose",
  minimumCliVersion: null,
  secrets: [],

  async check(project): Promise<AdapterCheckResult> {
    const errors: AdapterIssue[] = [];
    const warnings: AdapterIssue[] = [];

    const packageJsonPath = path.join(project.rootDir, "package.json");
    if (!(await pathExists(packageJsonPath))) {
      errors.push({
        code: CLI_ERROR_CODES.DEPLOY_CONFIG_INVALID,
        message: "package.json is missing — cannot build the app container.",
      });
    }
    return { ok: errors.length === 0, errors, warnings };
  },

  async prepare(project, options): Promise<AdapterArtifact[]> {
    const artifacts: AdapterArtifact[] = [];
    const rootDir = project.rootDir;
    const projectName = options.projectName ?? project.projectName;
    const includePostgres = true;
    const includeRedis = false;

    // Emit (or preserve) the Dockerfile used by the `app` service.
    const hasLockfile = await pathExists(path.join(rootDir, "bun.lock"));
    const dockerfileResult = await writeArtifact({
      forbiddenValues: options.forbiddenSecrets,
      path: path.join(rootDir, "Dockerfile"),
      content: renderDockerfile({
        hasLockfile,
        port: project.config.server?.port ?? DEFAULT_PORT,
      }),
      preserveIfExists: true,
    });
    artifacts.push({
      path: dockerfileResult.path,
      preserved: dockerfileResult.preserved,
      description: dockerfileResult.preserved
        ? "Existing Dockerfile preserved"
        : "Shared Dockerfile (docker-compose app service)",
    });

    // docker-compose.yml
    const composeResult = await writeArtifact({
      forbiddenValues: options.forbiddenSecrets,
      path: path.join(rootDir, "docker-compose.yml"),
      content: renderDockerCompose({
        projectName,
        appPort: project.config.server?.port ?? DEFAULT_PORT,
        includePostgres,
        includeRedis,
      }),
      preserveIfExists: true,
    });
    artifacts.push({
      path: composeResult.path,
      preserved: composeResult.preserved,
      description: composeResult.preserved
        ? "Existing docker-compose.yml preserved"
        : `Scaffolded docker-compose.yml (app + postgres)`,
    });

    // .env.example
    const envExampleResult = await writeArtifact({
      forbiddenValues: options.forbiddenSecrets,
      path: path.join(rootDir, ".env.example"),
      content: renderEnvExample(includePostgres, includeRedis),
      preserveIfExists: true,
    });
    artifacts.push({
      path: envExampleResult.path,
      preserved: envExampleResult.preserved,
      description: envExampleResult.preserved
        ? "Existing .env.example preserved"
        : "Environment scaffold — copy to .env before `docker compose up`",
    });

    return artifacts;
  },
};

async function pathExists(target: string): Promise<boolean> {
  try {
    await (await import("node:fs/promises")).access(target);
    return true;
  } catch {
    return false;
  }
}
