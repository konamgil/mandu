/**
 * Mandu CLI - OpenAPI Commands
 * OpenAPI 스펙 생성 명령어
 */

import { generateOpenAPIDocument, openAPIToJSON, validateAndReport } from "@mandujs/core";
import path from "path";
import fs from "fs/promises";
import { resolveManifest } from "../util/manifest";

interface OpenAPIGenerateOptions {
  output?: string;
  title?: string;
  version?: string;
}

interface OpenAPIServeOptions {
  port?: number;
}

function normalizePort(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const port = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(port) || !Number.isInteger(port)) {
    console.warn(`⚠️  Invalid ${label} value: "${value}" (using default)`);
    return undefined;
  }
  if (port < 1 || port > 65535) {
    console.warn(`⚠️  Invalid ${label} range: ${port} (must be 1-65535, using default)`);
    return undefined;
  }
  return port;
}

function isPortInUse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  return code === "EADDRINUSE" || message.includes("EADDRINUSE") || message.includes("address already in use");
}

function serveWithAutoPort(
  startPort: number,
  fetch: (req: Request) => Response
): { server: ReturnType<typeof Bun.serve>; port: number; attempts: number } {
  const maxAttempts = 10;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = startPort + attempt;
    if (candidate < 1 || candidate > 65535) {
      continue;
    }
    try {
      const server = Bun.serve({ port: candidate, fetch });
      return { server, port: server.port ?? candidate, attempts: attempt };
    } catch (error) {
      if (!isPortInUse(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error(`No available port found starting at ${startPort}`);
}

/**
 * Generate OpenAPI specification from contracts
 */
export async function openAPIGenerate(options: OpenAPIGenerateOptions = {}): Promise<boolean> {
  const rootDir = process.cwd();

  console.log(`\n📄 Generating OpenAPI specification...\n`);

  // Load manifest (FS Routes 우선)
  let manifest: Awaited<ReturnType<typeof resolveManifest>>["manifest"];
  try {
    const config = await validateAndReport(rootDir);
    if (!config) return false;
    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
  } catch (error) {
    console.error("❌ Failed to load manifest:", error instanceof Error ? error.message : error);
    return false;
  }

  // Count routes with contracts
  const contractRoutes = manifest.routes.filter((r) => r.contractModule);
  if (contractRoutes.length === 0) {
    console.log(`⚠️ No routes with contracts found.`);
    console.log(`\nTo generate OpenAPI docs, add contractModule to your routes.`);
    console.log(`Example:`);
    console.log(`  {`);
    console.log(`    "id": "users",`);
    console.log(`    "pattern": "/api/users",`);
    console.log(`    "contractModule": "spec/contracts/users.contract.ts"`);
    console.log(`  }`);
    return true;
  }

  console.log(`📝 Found ${contractRoutes.length} routes with contracts`);

  // Generate OpenAPI document
  try {
    const doc = await generateOpenAPIDocument(manifest, rootDir, {
      title: options.title,
      version: options.version,
    });

    const json = openAPIToJSON(doc);

    // Determine output path
    const outputPath = options.output || path.join(rootDir, "openapi.json");
    const outputDir = path.dirname(outputPath);

    // Ensure directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Write file
    await Bun.write(outputPath, json);

    console.log(`\n✅ Generated: ${path.relative(rootDir, outputPath)}`);

    // Show summary
    const pathCount = Object.keys(doc.paths).length;
    const tagCount = doc.tags?.length || 0;

    console.log(`\n📊 Summary:`);
    console.log(`   Paths: ${pathCount}`);
    console.log(`   Tags: ${tagCount}`);
    console.log(`   Version: ${doc.info.version}`);

    console.log(`\n💡 View your API docs:`);
    console.log(`   - Import into Swagger Editor: https://editor.swagger.io`);
    console.log(`   - Import into Postman`);
    console.log(`   - Run \`mandu openapi serve\` for local Swagger UI`);

    return true;
  } catch (error) {
    console.error(`❌ Failed to generate OpenAPI:`, error);
    return false;
  }
}

/**
 * Serve Swagger UI for OpenAPI documentation
 */
export async function openAPIServe(options: OpenAPIServeOptions = {}): Promise<boolean> {
  const rootDir = process.cwd();
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  const optionPort = normalizePort(options.port, "openapi.port");
  const envPort = normalizePort(process.env.PORT, "PORT");
  const configPort = normalizePort(config.server?.port, "mandu.config server.port");
  const desiredPort = optionPort ?? envPort ?? configPort ?? 8080;
  const openAPIPath = path.join(rootDir, "openapi.json");

  console.log(`\n🌐 Starting OpenAPI documentation server...\n`);

  // Check if openapi.json exists
  try {
    await fs.access(openAPIPath);
  } catch {
    console.log(`⚠️ openapi.json not found. Generating...`);
    const generated = await openAPIGenerate({});
    if (!generated) {
      return false;
    }
  }

  // Read OpenAPI spec
  const specContent = await Bun.file(openAPIPath).text();

  // Simple HTML for Swagger UI
  const swaggerHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mandu API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { font-size: 28px; }
    .swagger-ui .info { margin: 20px 0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        spec: ${specContent},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>
  `.trim();

  // Start server (auto port fallback)
  const { port, attempts } = serveWithAutoPort(desiredPort, (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/openapi.json") {
        return new Response(specContent, {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(swaggerHTML, {
        headers: { "Content-Type": "text/html" },
      });
  });

  if (attempts > 0) {
    console.warn(`⚠️  Port ${desiredPort} is in use. Using ${port} instead.`);
  }

  console.log(`✅ Swagger UI is running at http://localhost:${port}`);
  console.log(`   OpenAPI spec: http://localhost:${port}/openapi.json`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  // Keep server running
  await new Promise(() => {});

  return true;
}
