/**
 * Mandu CLI - OpenAPI Commands
 * OpenAPI 스펙 생성 명령어
 */

import { loadManifest, generateOpenAPIDocument, openAPIToJSON } from "@mandujs/core";
import path from "path";
import fs from "fs/promises";

interface OpenAPIGenerateOptions {
  output?: string;
  title?: string;
  version?: string;
}

interface OpenAPIServeOptions {
  port?: number;
}

/**
 * Generate OpenAPI specification from contracts
 */
export async function openAPIGenerate(options: OpenAPIGenerateOptions = {}): Promise<boolean> {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, "spec/routes.manifest.json");

  console.log(`\n📄 Generating OpenAPI specification...\n`);

  // Load manifest
  const manifestResult = await loadManifest(manifestPath);
  if (!manifestResult.success) {
    console.error("❌ Failed to load manifest:", manifestResult.errors);
    return false;
  }

  const manifest = manifestResult.data!;

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
  const port = options.port || 8080;
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

  // Start server
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/openapi.json") {
        return new Response(specContent, {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(swaggerHTML, {
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  console.log(`✅ Swagger UI is running at http://localhost:${port}`);
  console.log(`   OpenAPI spec: http://localhost:${port}/openapi.json`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  // Keep server running
  await new Promise(() => {});

  return true;
}
