/**
 * Mandu MCP Runtime Tools
 * Query and manage runtime configuration: logger settings and contract normalize options.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getProjectPaths } from "../utils/project.js";
import { loadManduConfig, loadManifest, needsHydration } from "@mandujs/core";
import { getDevServerState } from "./project.js";
import { readRuntimeControl } from "../utils/runtime-control.js";
import path from "path";


export const runtimeToolDefinitions: Tool[] = [
  {
    name: "mandu.runtime.config",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "Get the Mandu runtime configuration defaults for logger and normalize settings. " +
      "Shows default values for every configurable option along with usage examples. " +
      "Use this to understand the runtime before calling mandu.runtime.setNormalize " +
      "or mandu.runtime.loggerConfig.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu.runtime.probe",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "Probe a running Mandu dev/start server by fetching real page HTML and island bundle URLs. " +
      "Catches silent runtime failures that static manifest/guard checks miss, especially empty data-mandu-src island markers.",
    inputSchema: {
      type: "object",
      properties: {
        baseURL: {
          type: "string",
          description: "Explicit dev server URL. Overrides runtime-control/config discovery.",
        },
        port: {
          type: "number",
          description: "Explicit dev server port. Overrides runtime-control/config discovery.",
        },
        routeIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional route IDs to probe. Omit to probe all page routes that can be sampled.",
        },
        includeDynamic: {
          type: "boolean",
          description: "Probe dynamic routes by substituting __mandu_probe__ for params. Defaults to false.",
        },
        checkBundleUrls: {
          type: "boolean",
          description: "Fetch every non-empty data-mandu-src URL and require a 2xx response. Defaults to true.",
        },
        timeoutMs: {
          type: "number",
          description: "Per-request timeout in milliseconds. Defaults to 3000.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "mandu.runtime.contractOptions",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "Read the normalize and coerceQueryParams options currently set in a specific contract file. " +
      "These options control how incoming request data is validated and sanitized: " +
      "'normalize' removes or blocks undefined fields (Mass Assignment protection), " +
      "'coerceQueryParams' auto-converts URL query string values to their declared schema types (e.g., '123' → number). " +
      "Returns the parsed values and their effect, or defaults if no explicit options are set.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to get contract options for",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu.runtime.setNormalize",
    annotations: {
      readOnlyHint: false,
    },
    description:
      "Set the normalize mode (and optionally coerceQueryParams) in a route's contract file. " +
      "Normalize modes: " +
      "'strip' (default, recommended) — removes any request fields not defined in the schema, preventing Mass Assignment attacks. " +
      "'strict' — returns HTTP 400 if the request contains any field not defined in the schema. " +
      "'passthrough' — allows all fields through without filtering (validation only, no sanitization). " +
      "coerceQueryParams: when true (default), auto-converts query string values to their declared schema types.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to update",
        },
        normalize: {
          type: "string",
          enum: ["strip", "strict", "passthrough"],
          description:
            "Normalize mode: 'strip' (remove undefined fields, prevents Mass Assignment), " +
            "'strict' (return 400 on undefined fields), 'passthrough' (allow all fields through)",
        },
        coerceQueryParams: {
          type: "boolean",
          description: "Auto-convert URL query string values to schema-declared types (default: true)",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu.runtime.loggerOptions",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "List all available logger configuration options with types, defaults, and descriptions. " +
      "Covers: log format, level, header/body logging (security risk warnings), " +
      "sampling rate, slow request threshold, redaction fields, custom sink, and skip patterns. " +
      "Use this as a reference before calling mandu.runtime.loggerConfig.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu.runtime.loggerConfig",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    description:
      "Generate ready-to-use TypeScript logger configuration code for a specific environment. " +
      "Returns an import statement and logger() call with environment-appropriate defaults: " +
      "development: debug level, pretty format, higher verbosity; " +
      "production: info level, JSON format, 10% sampling, no headers/body. " +
      "Security note: includeHeaders and includeBody are forced to false in production regardless of input.",
    inputSchema: {
      type: "object",
      properties: {
        environment: {
          type: "string",
          enum: ["development", "production", "testing"],
          description: "Target environment — determines default log level, format, and sampling rate (default: development)",
        },
        includeHeaders: {
          type: "boolean",
          description: "Log request headers — security risk, only recommended in development (default: false)",
        },
        includeBody: {
          type: "boolean",
          description: "Log request body — security risk, only recommended in development (default: false)",
        },
        format: {
          type: "string",
          enum: ["pretty", "json"],
          description: "Log output format: 'pretty' (colored, human-readable) or 'json' (structured, for log aggregators)",
        },
        customRedact: {
          type: "array",
          items: { type: "string" },
          description: "Additional header or field names to redact/mask from logs",
        },
      },
      required: [],
    },
  },
];

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return null;
  }
}

export function runtimeTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.runtime.config": async () => {
      return {
        defaults: {
          logger: {
            format: "pretty",
            level: "info",
            includeHeaders: false,
            includeBody: false,
            maxBodyBytes: 1024,
            sampleRate: 1,
            slowThresholdMs: 1000,
            redact: [
              "authorization",
              "cookie",
              "set-cookie",
              "x-api-key",
              "password",
              "token",
              "secret",
              "bearer",
              "credential",
            ],
          },
          normalize: {
            mode: "strip",
            coerceQueryParams: true,
            deep: true,
          },
        },
        description: {
          logger: {
            format: "Log output format: 'pretty' (colored, dev) or 'json' (structured, prod)",
            level: "Minimum log level: 'debug' | 'info' | 'warn' | 'error'",
            includeHeaders: "⚠️ Security risk if true — logs all request headers including Authorization, Cookie",
            includeBody: "⚠️ Security risk if true — logs raw request body; may expose PII",
            maxBodyBytes: "Maximum body bytes to log (truncates larger bodies to avoid log bloat)",
            sampleRate: "Sampling rate 0.0–1.0 (1.0 = 100% of requests logged)",
            slowThresholdMs: "Requests exceeding this threshold (ms) are logged at warn level with details",
            redact: "Header/field names to mask in logs (replaces value with '[REDACTED]')",
          },
          normalize: {
            mode: "strip: remove undefined fields (prevents Mass Assignment attacks), strict: return 400 on undefined fields, passthrough: allow all fields (validation only)",
            coerceQueryParams: "Auto-convert URL query string '123' → number 123 based on schema type",
            deep: "Apply normalization recursively to nested objects",
          },
        },
        usage: {
          logger: `import { logger, devLogger, prodLogger } from "@mandujs/core";

// Development
app.use(devLogger());

// Production
app.use(prodLogger({ sampleRate: 0.1 }));`,
          normalize: `// In contract definition
export default Mandu.contract({
  normalize: "strip",  // or "strict" | "passthrough"
  coerceQueryParams: true,
  request: { ... },
  response: { ... },
});`,
        },
      };
    },

    "mandu.runtime.probe": async (args: Record<string, unknown>) => {
      const baseUrl = await resolveDevServerBaseUrl(projectRoot, args);
      const timeoutMs = normalizeTimeout(args.timeoutMs);
      const checkBundleUrls = args.checkBundleUrls !== false;
      const includeDynamic = args.includeDynamic === true;
      const routeIdFilter = Array.isArray(args.routeIds)
        ? new Set(args.routeIds.filter((id): id is string => typeof id === "string"))
        : null;

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return {
          success: false,
          baseUrl,
          error: result.errors,
        };
      }

      const pageRoutes = result.data.routes
        .filter((route) => route.kind === "page")
        .filter((route) => !routeIdFilter || routeIdFilter.has(route.id))
        .map((route) => ({
          route,
          samplePath: samplePathForPattern(route.pattern, includeDynamic),
        }));

      const skipped = pageRoutes
        .filter((entry) => entry.samplePath === null)
        .map((entry) => ({
          routeId: entry.route.id,
          pattern: entry.route.pattern,
          reason: "dynamic_route",
        }));
      const probes = await Promise.all(
        pageRoutes
          .filter((entry): entry is typeof entry & { samplePath: string } => entry.samplePath !== null)
          .map((entry) =>
            probeRoute({
              baseUrl,
              route: entry.route,
              samplePath: entry.samplePath,
              timeoutMs,
              checkBundleUrls,
            })
          )
      );

      const failures = probes.flatMap((probe) =>
        probe.failures.map((failure) => ({
          routeId: probe.routeId,
          pattern: probe.pattern,
          path: probe.path,
          ...failure,
        }))
      );

      return {
        success: failures.length === 0,
        baseUrl,
        checkedRoutes: probes.length,
        skippedRoutes: skipped.length,
        failureCount: failures.length,
        failures,
        routes: probes,
        skipped,
      };
    },

    "mandu.runtime.contractOptions": async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.contractModule) {
        return {
          routeId,
          hasContract: false,
          defaults: {
            normalize: "strip",
            coerceQueryParams: true,
          },
          suggestion: `Create a contract with: mandu.contract.create({ routeId: "${routeId}" })`,
        };
      }

      // Read contract file and extract options
      const contractPath = path.join(projectRoot, route.contractModule);
      const contractContent = await readFileContent(contractPath);

      if (!contractContent) {
        return {
          routeId,
          contractModule: route.contractModule,
          error: "Contract file not found",
        };
      }

      // Parse normalize and coerceQueryParams from content
      const normalizeMatch = contractContent.match(/normalize\s*:\s*["'](\w+)["']/);
      const coerceMatch = contractContent.match(/coerceQueryParams\s*:\s*(true|false)/);

      return {
        routeId,
        contractModule: route.contractModule,
        options: {
          normalize: normalizeMatch?.[1] || "strip (default)",
          coerceQueryParams: coerceMatch ? coerceMatch[1] === "true" : "true (default)",
        },
        explanation: {
          normalize: {
            strip: "Removes any request fields not defined in the schema — prevents Mass Assignment attacks (recommended default)",
            strict: "Returns HTTP 400 if the request contains any field not defined in the schema",
            passthrough: "Allows all fields through without filtering — validation only, no sanitization",
          },
          coerceQueryParams: "URL query strings are always plain strings; this option auto-converts them to the declared schema types (e.g., '42' → number, 'true' → boolean)",
        },
      };
    },

    "mandu.runtime.setNormalize": async (args: Record<string, unknown>) => {
      const { routeId, normalize, coerceQueryParams } = args as {
        routeId: string;
        normalize?: "strip" | "strict" | "passthrough";
        coerceQueryParams?: boolean;
      };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.contractModule) {
        return {
          error: "Route has no contract module",
          suggestion: `Create a contract first: mandu.contract.create({ routeId: "${routeId}" })`,
        };
      }

      const contractPath = path.join(projectRoot, route.contractModule);
      let content = await readFileContent(contractPath);

      if (!content) {
        return { error: `Contract file not found: ${route.contractModule}` };
      }

      const changes: string[] = [];

      // Update normalize option
      if (normalize) {
        if (content.includes("normalize:")) {
          content = content.replace(
            /normalize\s*:\s*["']\w+["']/,
            `normalize: "${normalize}"`
          );
          changes.push(`normalize: "${normalize}"`);
        } else {
          // Add normalize option after description or tags
          const insertPoint =
            content.indexOf("request:") ||
            content.indexOf("response:");
          if (insertPoint > 0) {
            const before = content.slice(0, insertPoint);
            const after = content.slice(insertPoint);
            content = before + `normalize: "${normalize}",\n  ` + after;
            changes.push(`normalize: "${normalize}" (added)`);
          }
        }
      }

      // Update coerceQueryParams option
      if (coerceQueryParams !== undefined) {
        if (content.includes("coerceQueryParams:")) {
          content = content.replace(
            /coerceQueryParams\s*:\s*(true|false)/,
            `coerceQueryParams: ${coerceQueryParams}`
          );
          changes.push(`coerceQueryParams: ${coerceQueryParams}`);
        } else if (insertAfter(content, "normalize:")) {
          content = content.replace(
            /(normalize\s*:\s*["']\w+["']),?/,
            `$1,\n  coerceQueryParams: ${coerceQueryParams},`
          );
          changes.push(`coerceQueryParams: ${coerceQueryParams} (added)`);
        }
      }

      if (changes.length === 0) {
        return {
          success: false,
          message: "No changes to apply",
          currentContent: content.slice(0, 500) + "...",
        };
      }

      // Write updated content
      await Bun.write(contractPath, content);

      return {
        success: true,
        contractModule: route.contractModule,
        changes,
        message: `Updated ${route.contractModule}`,
        securityNote:
          normalize === "passthrough"
            ? "⚠️ passthrough mode may be vulnerable to Mass Assignment attacks. Only use with trusted, fully-validated input."
            : normalize === "strict"
            ? "strict mode returns HTTP 400 if the client sends any field not defined in the contract schema."
            : "strip mode (recommended): fields not defined in the schema are automatically removed from the request.",
      };
    },

    "mandu.runtime.loggerOptions": async () => {
      return {
        options: [
          {
            name: "format",
            type: '"pretty" | "json"',
            default: "pretty",
            description: "Log output format: 'pretty' (colored, human-readable for dev) or 'json' (structured, for log aggregators in prod)",
          },
          {
            name: "level",
            type: '"debug" | "info" | "warn" | "error"',
            default: "info",
            description: "Minimum log level: 'debug' (all requests with details), 'info' (standard), 'warn' (slow/suspicious only), 'error' (errors only)",
          },
          {
            name: "includeHeaders",
            type: "boolean",
            default: false,
            description: "⚠️ Security risk — logs all request headers including Authorization and Cookie. Only enable in development.",
          },
          {
            name: "includeBody",
            type: "boolean",
            default: false,
            description: "⚠️ Security risk — logs raw request body which may contain PII or credentials. Only enable in development.",
          },
          {
            name: "maxBodyBytes",
            type: "number",
            default: 1024,
            description: "Maximum bytes of request body to log (larger bodies are truncated to avoid log bloat)",
          },
          {
            name: "redact",
            type: "string[]",
            default: '["authorization", "cookie", "password", ...]',
            description: "Header or field names to mask in logs (values are replaced with '[REDACTED]')",
          },
          {
            name: "requestId",
            type: '"auto" | ((ctx) => string)',
            default: "auto",
            description: "Request ID generation strategy: 'auto' uses UUID or timestamp-based ID, or provide a custom function",
          },
          {
            name: "sampleRate",
            type: "number (0.0–1.0)",
            default: 1,
            description: "Fraction of requests to log (1.0 = 100%, 0.1 = 10%). Reduce in production to control log volume.",
          },
          {
            name: "slowThresholdMs",
            type: "number",
            default: 1000,
            description: "Requests exceeding this duration (ms) are logged at warn level with full details",
          },
          {
            name: "includeTraceOnSlow",
            type: "boolean",
            default: true,
            description: "Include a timing trace report in the log entry for slow requests",
          },
          {
            name: "sink",
            type: "(entry: LogEntry) => void",
            default: "console",
            description: "Custom log output handler — use for integrating with Pino, CloudWatch, Datadog, etc.",
          },
          {
            name: "skip",
            type: "(string | RegExp)[]",
            default: "[]",
            description: 'URL path patterns to exclude from logging. Example: ["/health", /^\\/static\\//]',
          },
        ],
        presets: {
          devLogger: "Development preset: debug level, pretty format, detailed output",
          prodLogger: "Production preset: info level, JSON format, no headers/body logging",
        },
      };
    },

    "mandu.runtime.loggerConfig": async (args: Record<string, unknown>) => {
      const {
        environment = "development",
        includeHeaders = false,
        includeBody = false,
        format,
        customRedact = [],
      } = args as {
        environment?: "development" | "production" | "testing";
        includeHeaders?: boolean;
        includeBody?: boolean;
        format?: "pretty" | "json";
        customRedact?: string[];
      };

      const isDev = environment === "development";
      const isProd = environment === "production";

      const config = {
        format: format || (isDev ? "pretty" : "json"),
        level: isDev ? "debug" : "info",
        includeHeaders: isDev ? includeHeaders : false,
        includeBody: isDev ? includeBody : false,
        maxBodyBytes: 1024,
        sampleRate: isProd ? 0.1 : 1,
        slowThresholdMs: isDev ? 500 : 1000,
        ...(customRedact.length > 0 && { redact: customRedact }),
      };

      const code = `import { logger } from "@mandujs/core";

// ${environment} environment logger configuration
export const appLogger = logger(${JSON.stringify(config, null, 2)});

// Usage in your app:
// app.use(appLogger);
`;

      const warnings: string[] = [];
      if (includeHeaders && isProd) {
        warnings.push("⚠️ includeHeaders: true in production may expose sensitive Authorization, Cookie, and API key headers in logs.");
      }
      if (includeBody && isProd) {
        warnings.push("⚠️ includeBody: true in production may expose PII, passwords, or credentials in logs.");
      }

      return {
        environment,
        config,
        code,
        warnings: warnings.length > 0 ? warnings : undefined,
        tips: [
          "You can also use the devLogger() or prodLogger() preset helpers for quick setup.",
          "Use the 'sink' option to integrate with external systems like Pino, CloudWatch, or Datadog.",
          "Use the 'skip' option to exclude health check and static asset paths (e.g., ['/health', '/metrics']).",
        ],
      };
    },
  };

  // Backward-compatible aliases (deprecated)
  handlers["mandu_get_runtime_config"] = handlers["mandu.runtime.config"];
  handlers["mandu_set_contract_normalize"] = handlers["mandu.runtime.setNormalize"];
  handlers["mandu_get_contract_options"] = handlers["mandu.runtime.contractOptions"];
  handlers["mandu_list_logger_options"] = handlers["mandu.runtime.loggerOptions"];
  handlers["mandu_generate_logger_config"] = handlers["mandu.runtime.loggerConfig"];
  handlers["mandu_runtime_probe"] = handlers["mandu.runtime.probe"];

  return handlers;
}

function insertAfter(content: string, search: string): boolean {
  return content.includes(search);
}

async function resolveDevServerBaseUrl(
  projectRoot: string,
  args: { baseURL?: unknown; port?: unknown } = {},
): Promise<string> {
  if (typeof args.baseURL === "string" && args.baseURL.trim()) {
    return args.baseURL.trim().replace(/\/+$/, "");
  }

  const explicitPort = normalizePort(args.port);
  if (explicitPort) {
    return `http://localhost:${explicitPort}`;
  }

  const control = await readRuntimeControl(projectRoot);
  if (control?.baseUrl) {
    return control.baseUrl.replace(/\/+$/, "");
  }

  let port: number | undefined;
  const serverState = getDevServerState();
  if (serverState) {
    for (const line of serverState.output) {
      const portMatch = line.match(/https?:\/\/localhost:(\d+)/);
      if (portMatch) {
        port = Number.parseInt(portMatch[1], 10);
      }
    }
  }

  if (!port) {
    const config = await loadManduConfig(projectRoot);
    port = config.server?.port ?? 3333;
  }

  return `http://localhost:${port}`;
}

function normalizePort(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isInteger(raw) || raw < 1 || raw > 65535) return undefined;
  return raw;
}

function normalizeTimeout(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isInteger(raw) || raw < 100 || raw > 30_000) return 3000;
  return raw;
}

function samplePathForPattern(pattern: string, includeDynamic: boolean): string | null {
  if (!includeDynamic && /(^|\/):[^/]+/.test(pattern)) return null;
  const sampled = pattern
    .replace(/:([A-Za-z0-9_]+)/g, "__mandu_probe__")
    .replace(/\*+/g, "__mandu_probe__");
  return sampled.startsWith("/") ? sampled : `/${sampled}`;
}

interface IslandMarker {
  id: string | null;
  src: string | null;
}

function extractIslandMarkers(html: string): IslandMarker[] {
  const markers: IslandMarker[] = [];
  const tagPattern = /<[^>]*\bdata-mandu-island(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    markers.push({
      id: readHtmlAttr(tag, "data-mandu-island"),
      src: readHtmlAttr(tag, "data-mandu-src"),
    });
  }
  return markers;
}

function readHtmlAttr(tag: string, attr: string): string | null {
  const pattern = new RegExp(
    `\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

async function probeRoute({
  baseUrl,
  route,
  samplePath,
  timeoutMs,
  checkBundleUrls,
}: {
  baseUrl: string;
  route: { id: string; pattern: string; clientModule?: string; hydration?: unknown };
  samplePath: string;
  timeoutMs: number;
  checkBundleUrls: boolean;
}): Promise<{
  routeId: string;
  pattern: string;
  path: string;
  status: number | null;
  islandCount: number;
  failures: Array<{ code: string; message: string; islandId?: string | null; src?: string | null; status?: number | null }>;
}> {
  const failures: Array<{ code: string; message: string; islandId?: string | null; src?: string | null; status?: number | null }> = [];
  const url = new URL(samplePath, `${baseUrl}/`);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return {
      routeId: route.id,
      pattern: route.pattern,
      path: samplePath,
      status: null,
      islandCount: 0,
      failures: [{
        code: "page_fetch_failed",
        message: error instanceof Error ? error.message : String(error),
        status: null,
      }],
    };
  }

  if (!response.ok) {
    failures.push({
      code: "page_status",
      message: `Page responded with HTTP ${response.status}`,
      status: response.status,
    });
  }

  const html = await response.text();
  const markers = extractIslandMarkers(html);
  const hasRouteIsland = markers.some((marker) => marker.id === route.id);
  if (route.clientModule && needsHydration(route as Parameters<typeof needsHydration>[0]) && !hasRouteIsland) {
    failures.push({
      code: "missing_route_island_marker",
      message: `Route has clientModule but HTML does not contain data-mandu-island="${route.id}"`,
      islandId: route.id,
    });
  }

  for (const marker of markers) {
    if (!marker.src || marker.src.trim().length === 0) {
      failures.push({
        code: "empty_island_src",
        message: "Island marker has empty data-mandu-src",
        islandId: marker.id,
        src: marker.src,
      });
      continue;
    }
    if (!checkBundleUrls) continue;

    const bundleUrl = new URL(marker.src, `${baseUrl}/`);
    try {
      const bundleResponse = await fetch(bundleUrl, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!bundleResponse.ok) {
        failures.push({
          code: "bundle_status",
          message: `Island bundle responded with HTTP ${bundleResponse.status}`,
          islandId: marker.id,
          src: marker.src,
          status: bundleResponse.status,
        });
      }
    } catch (error) {
      failures.push({
        code: "bundle_fetch_failed",
        message: error instanceof Error ? error.message : String(error),
        islandId: marker.id,
        src: marker.src,
        status: null,
      });
    }
  }

  return {
    routeId: route.id,
    pattern: route.pattern,
    path: samplePath,
    status: response.status,
    islandCount: markers.length,
    failures,
  };
}
