/**
 * Contract Playground API
 *
 * GET  /__kitchen/api/contracts           → list all contracts
 * GET  /__kitchen/api/contracts/:id       → contract detail (with OpenAPI schema)
 * POST /__kitchen/api/contracts/validate  → validate input against contract
 * GET  /__kitchen/api/contracts/openapi   → full OpenAPI 3.0.3 document (JSON)
 * GET  /__kitchen/api/contracts/openapi.yaml → OpenAPI YAML
 */

import type { RoutesManifest, RouteSpec } from "../../spec/schema";
import {
  generateOpenAPIDocument,
  zodToOpenAPISchema,
  openAPIToJSON,
  openAPIToYAML,
} from "../../openapi/generator";
import path from "path";

export interface ContractListItem {
  id: string;
  pattern: string;
  methods: string[];
  description?: string;
}

export class ContractPlaygroundAPI {
  private manifest: RoutesManifest;

  constructor(
    manifest: RoutesManifest,
    private rootDir: string,
  ) {
    this.manifest = manifest;
  }

  updateManifest(manifest: RoutesManifest): void {
    this.manifest = manifest;
  }

  /** GET /__kitchen/api/contracts */
  async handleList(): Promise<Response> {
    const contracts: ContractListItem[] = [];

    for (const route of this.manifest.routes) {
      if (!route.contractModule) continue;

      const contract = await this.loadContract(route);
      contracts.push({
        id: route.id,
        pattern: route.pattern,
        methods: contract ? Object.keys(contract.request || {}) : route.methods || [],
        description: contract?.description,
      });
    }

    return Response.json({ contracts });
  }

  /** GET /__kitchen/api/contracts/:id */
  async handleDetail(id: string): Promise<Response> {
    const route = this.manifest.routes.find((r) => r.id === id);
    if (!route || !route.contractModule) {
      return Response.json({ error: "Contract not found" }, { status: 404 });
    }

    const contract = await this.loadContract(route);
    if (!contract) {
      return Response.json({ error: "Failed to load contract" }, { status: 500 });
    }

    // Build OpenAPI-like schema for each method
    const schemas: Record<string, unknown> = {};
    const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    for (const method of HTTP_METHODS) {
      const methodSchema = contract.request?.[method];
      if (!methodSchema) continue;

      const schema: Record<string, unknown> = {};
      if (methodSchema.query) {
        schema.query = zodToOpenAPISchema(methodSchema.query);
      }
      if (methodSchema.body) {
        schema.body = zodToOpenAPISchema(methodSchema.body);
      }
      if (methodSchema.params) {
        schema.params = zodToOpenAPISchema(methodSchema.params);
      }
      if (methodSchema.headers) {
        schema.headers = zodToOpenAPISchema(methodSchema.headers);
      }
      schemas[method] = schema;
    }

    // Response schemas
    const responseSchemas: Record<string, unknown> = {};
    for (const [status, resSchema] of Object.entries(contract.response || {})) {
      if (resSchema && typeof resSchema === "object" && "schema" in resSchema) {
        responseSchemas[status] = zodToOpenAPISchema((resSchema as any).schema);
      } else if (resSchema) {
        responseSchemas[status] = zodToOpenAPISchema(resSchema as any);
      }
    }

    return Response.json({
      id: route.id,
      pattern: route.pattern,
      description: contract.description,
      tags: contract.tags,
      normalize: contract.normalize,
      request: schemas,
      response: responseSchemas,
    });
  }

  /** POST /__kitchen/api/contracts/validate */
  async handleValidate(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { contractId, method, input } = body as {
        contractId: string;
        method: string;
        input: { query?: unknown; body?: unknown; params?: unknown };
      };

      if (!contractId || !method) {
        return Response.json(
          { error: "Missing contractId or method" },
          { status: 400 },
        );
      }

      const route = this.manifest.routes.find((r) => r.id === contractId);
      if (!route || !route.contractModule) {
        return Response.json(
          { error: "Contract not found" },
          { status: 404 },
        );
      }

      const contract = await this.loadContract(route);
      if (!contract) {
        return Response.json(
          { error: "Failed to load contract" },
          { status: 500 },
        );
      }

      const methodSchema = contract.request?.[method];
      if (!methodSchema) {
        return Response.json(
          { error: `Method ${method} not defined in contract` },
          { status: 400 },
        );
      }

      const errors: Array<{ field: string; issues: unknown[] }> = [];

      // Validate query
      if (methodSchema.query && input?.query !== undefined) {
        const result = methodSchema.query.safeParse(input.query);
        if (!result.success) {
          errors.push({ field: "query", issues: result.error.issues });
        }
      }

      // Validate body
      if (methodSchema.body && input?.body !== undefined) {
        const result = methodSchema.body.safeParse(input.body);
        if (!result.success) {
          errors.push({ field: "body", issues: result.error.issues });
        }
      }

      // Validate params
      if (methodSchema.params && input?.params !== undefined) {
        const result = methodSchema.params.safeParse(input.params);
        if (!result.success) {
          errors.push({ field: "params", issues: result.error.issues });
        }
      }

      if (errors.length > 0) {
        return Response.json({ valid: false, errors });
      }

      return Response.json({ valid: true });
    } catch (e) {
      return Response.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
  }

  /** GET /__kitchen/api/contracts/openapi */
  async handleOpenAPI(): Promise<Response> {
    const doc = await generateOpenAPIDocument(this.manifest, this.rootDir);
    return new Response(openAPIToJSON(doc), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  /** GET /__kitchen/api/contracts/openapi.yaml */
  async handleOpenAPIYAML(): Promise<Response> {
    const doc = await generateOpenAPIDocument(this.manifest, this.rootDir);
    return new Response(openAPIToYAML(doc), {
      headers: { "Content-Type": "text/yaml; charset=utf-8" },
    });
  }

  // ────────────────────────────────────────────────

  private async loadContract(route: RouteSpec): Promise<any | null> {
    if (!route.contractModule) return null;
    try {
      const fullPath = path.join(this.rootDir, route.contractModule);
      const module = await import(fullPath);
      return module.default;
    } catch {
      return null;
    }
  }
}
