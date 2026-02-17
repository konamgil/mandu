/**
 * Mandu Contract Registry
 * Build-time contract index for tooling, docs, and guard
 */

import type { RoutesManifest } from "../spec/schema";
import type { ContractSchema, MethodRequestSchema } from "./schema";
import path from "path";
import { createHash } from "crypto";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export interface ContractRegistryEntry {
  id: string;
  routeId: string;
  file: string;
  methods: string[];
  request: Record<string, {
    query: boolean;
    body: boolean;
    params: boolean;
    headers: boolean;
  }>;
  response: number[];
  schemas?: {
    request?: Record<string, {
      query?: SchemaSummary;
      body?: SchemaSummary;
      params?: SchemaSummary;
      headers?: SchemaSummary;
    }>;
    response?: Record<number, SchemaSummary | undefined>;
  };
  hash: string | null;
  description?: string;
  tags?: string[];
  normalize?: ContractSchema["normalize"];
  coerceQueryParams?: ContractSchema["coerceQueryParams"];
  version?: string;
  meta?: Record<string, unknown>;
}

export type SchemaSummary =
  | {
      type: "object";
      keys: string[];
      required: string[];
    }
  | {
      type: "enum";
      values: Array<string | number>;
    }
  | {
      type: "literal";
      value: string | number | boolean | null;
    }
  | {
      type: "other";
      typeName?: string;
    };

export interface ContractRegistry {
  version: 1;
  generatedAt: string;
  contracts: ContractRegistryEntry[];
}

export interface ContractRegistryResult {
  registry: ContractRegistry;
  warnings: string[];
}

export interface ContractRegistryChange {
  id: string;
  routeId: string;
  severity: "major" | "minor" | "patch";
  changes: string[];
  before?: ContractRegistryEntry;
  after?: ContractRegistryEntry;
}

export interface ContractRegistryDiff {
  added: ContractRegistryEntry[];
  removed: ContractRegistryEntry[];
  changed: ContractRegistryChange[];
  summary: {
    major: number;
    minor: number;
    patch: number;
  };
}

/** Zod 내부 구조를 duck typing으로 접근하기 위한 인터페이스 */
interface ZodLike {
  _def?: {
    typeName?: string;
    innerType?: ZodLike;
    schema?: ZodLike;
    type?: ZodLike;
    shape?: (() => Record<string, ZodLike>) | Record<string, ZodLike>;
    values?: unknown[] | Record<string, unknown>;
    value?: unknown;
  };
}

async function loadContract(contractPath: string, rootDir: string): Promise<ContractSchema | null> {
  try {
    const fullPath = path.join(rootDir, contractPath);
    const module = await import(fullPath);
    return module.default ?? null;
  } catch {
    return null;
  }
}

async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await Bun.file(filePath).text();
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function extractRequestInfo(contract: ContractSchema): ContractRegistryEntry["request"] {
  const requestInfo: ContractRegistryEntry["request"] = {};

  for (const method of HTTP_METHODS) {
    const methodSchema = contract.request[method] as MethodRequestSchema | undefined;
    if (!methodSchema) continue;

    requestInfo[method] = {
      query: Boolean(methodSchema.query),
      body: Boolean(methodSchema.body),
      params: Boolean(methodSchema.params),
      headers: Boolean(methodSchema.headers),
    };
  }

  return requestInfo;
}

function unwrapSchema(schema: ZodLike): ZodLike {
  let current = schema;
  let depth = 0;

  while (current && current._def && depth < 10) {
    const typeName = current._def.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodDefault") {
      current = current._def.innerType ?? current;
    } else if (typeName === "ZodEffects") {
      current = current._def.schema ?? current;
    } else if (typeName === "ZodNullable") {
      current = current._def.innerType ?? current;
    } else if (typeName === "ZodBranded" || typeName === "ZodCatch") {
      current = current._def.type ?? current;
    } else {
      break;
    }
    depth += 1;
  }

  return current;
}

function isOptionalSchema(schema: ZodLike): boolean {
  let current = schema;
  let depth = 0;
  while (current && current._def && depth < 10) {
    const typeName = current._def.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodDefault") {
      return true;
    }
    if (typeName === "ZodEffects" || typeName === "ZodNullable" || typeName === "ZodBranded" || typeName === "ZodCatch") {
      current = current._def.schema ?? current._def.innerType ?? current._def.type ?? current;
      depth += 1;
      continue;
    }
    break;
  }
  return false;
}

function summarizeSchema(schema: ZodLike): SchemaSummary | undefined {
  if (!schema || !schema._def) return undefined;

  const base = unwrapSchema(schema);
  const def = base?._def;
  if (!def) return undefined;

  const typeName = def.typeName;

  if (typeName === "ZodObject") {
    const shape = typeof def.shape === "function" ? def.shape() : (def.shape as Record<string, ZodLike> | undefined);
    const keys = Object.keys(shape ?? {}).sort();
    const required = keys.filter((key) => !isOptionalSchema((shape ?? {})[key]));
    return {
      type: "object",
      keys,
      required: required.sort(),
    };
  }

  if (typeName === "ZodEnum") {
    const values = Array.isArray(def.values) ? def.values.slice() : [];
    values.sort();
    return {
      type: "enum",
      values: values as Array<string | number>,
    };
  }

  if (typeName === "ZodNativeEnum") {
    const rawValues = def.values && !Array.isArray(def.values) ? Object.values(def.values) : [];
    const values = rawValues.filter((v: unknown) => typeof v === "string" || typeof v === "number") as Array<string | number>;
    values.sort();
    return {
      type: "enum",
      values,
    };
  }

  if (typeName === "ZodLiteral") {
    return {
      type: "literal",
      value: def.value as string | number | boolean | null,
    };
  }

  return {
    type: "other",
    typeName,
  };
}

function extractSchemaSummaries(contract: ContractSchema): ContractRegistryEntry["schemas"] {
  const request: Record<string, {
    query?: SchemaSummary;
    body?: SchemaSummary;
    params?: SchemaSummary;
    headers?: SchemaSummary;
  }> = {};
  const response: Record<number, SchemaSummary> = {};

  for (const method of HTTP_METHODS) {
    const methodSchema = contract.request[method] as MethodRequestSchema | undefined;
    if (!methodSchema) continue;

    request[method] = {
      query: methodSchema.query ? summarizeSchema(methodSchema.query as ZodLike) : undefined,
      body: methodSchema.body ? summarizeSchema(methodSchema.body as ZodLike) : undefined,
      params: methodSchema.params ? summarizeSchema(methodSchema.params as ZodLike) : undefined,
      headers: methodSchema.headers ? summarizeSchema(methodSchema.headers as ZodLike) : undefined,
    };
  }

  for (const [statusCode, schema] of Object.entries(contract.response)) {
    const code = Number(statusCode);
    if (Number.isNaN(code)) continue;
    if (!schema) continue;

    // 일부 핸들러는 응답 스키마를 { schema: ZodSchema } 형태로 래핑해서 반환함
    // summarizeSchema는 원시 Zod 스키마를 기대하므로 내부 schema 필드 언래핑
    const actualSchema = (schema as { schema?: unknown }).schema ?? schema;
    const summary = summarizeSchema(actualSchema as ZodLike);
    if (summary) {
      response[code] = summary;
    }
  }

  return {
    request,
    response,
  };
}

function extractMethods(contract: ContractSchema): string[] {
  return HTTP_METHODS.filter((method) => Boolean(contract.request[method]));
}

function extractResponseCodes(contract: ContractSchema): number[] {
  return Object.keys(contract.response)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => Number(key))
    .sort((a, b) => a - b);
}

export async function buildContractRegistry(
  manifest: RoutesManifest,
  rootDir: string
): Promise<ContractRegistryResult> {
  const warnings: string[] = [];
  const contracts: ContractRegistryEntry[] = [];

  for (const route of manifest.routes) {
    if (!route.contractModule) continue;

    const contract = await loadContract(route.contractModule, rootDir);
    if (!contract) {
      warnings.push(`Failed to load contract: ${route.contractModule} (routeId: ${route.id})`);
      continue;
    }

    const contractPath = path.join(rootDir, route.contractModule);
    const hash = await computeFileHash(contractPath);
    const id = contract.name ?? route.id;

    contracts.push({
      id,
      routeId: route.id,
      file: route.contractModule,
      methods: extractMethods(contract),
      request: extractRequestInfo(contract),
      response: extractResponseCodes(contract),
      schemas: extractSchemaSummaries(contract),
      hash,
      description: contract.description,
      tags: contract.tags,
      normalize: contract.normalize,
      coerceQueryParams: contract.coerceQueryParams,
      version: contract.version,
      meta: contract.meta,
    });
  }

  return {
    registry: {
      version: 1,
      generatedAt: new Date().toISOString(),
      contracts,
    },
    warnings,
  };
}

export async function writeContractRegistry(
  registryPath: string,
  registry: ContractRegistry
): Promise<void> {
  await Bun.write(registryPath, JSON.stringify(registry, null, 2));
}

export async function readContractRegistry(
  registryPath: string
): Promise<ContractRegistry | null> {
  try {
    const file = Bun.file(registryPath);
    const exists = await file.exists();
    if (!exists) return null;
    const content = await file.text();
    return JSON.parse(content) as ContractRegistry;
  } catch {
    return null;
  }
}

function diffArray<T>(prev: T[], next: T[]): { added: T[]; removed: T[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((item) => !prevSet.has(item));
  const removed = prev.filter((item) => !nextSet.has(item));
  return { added, removed };
}

function diffRequestShapes(
  prev: ContractRegistryEntry["request"],
  next: ContractRegistryEntry["request"]
): { major: string[]; minor: string[] } {
  const major: string[] = [];
  const minor: string[] = [];
  const methods = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const method of methods) {
    const before = prev[method];
    const after = next[method];
    if (!before || !after) continue;

    for (const key of ["query", "body", "params", "headers"] as const) {
      const beforeHas = Boolean(before[key]);
      const afterHas = Boolean(after[key]);
      if (beforeHas && !afterHas) {
        major.push(`${method}.${key} removed`);
      } else if (!beforeHas && afterHas) {
        minor.push(`${method}.${key} added`);
      }
    }
  }

  return { major, minor };
}

function diffSchemaSummary(
  prev?: SchemaSummary,
  next?: SchemaSummary
): { major: string[]; minor: string[] } {
  if (!prev || !next) return { major: [], minor: [] };

  if (prev.type !== next.type) {
    return {
      major: [`schema type changed: ${prev.type} -> ${next.type}`],
      minor: [],
    };
  }

  if (prev.type === "object" && next.type === "object") {
    const prevKeys = new Set(prev.keys);
    const nextKeys = new Set(next.keys);

    const removed = prev.keys.filter((k) => !nextKeys.has(k));
    const added = next.keys.filter((k) => !prevKeys.has(k));

    const prevRequired = new Set(prev.required);
    const nextRequired = new Set(next.required);

    const major: string[] = [];
    const minor: string[] = [];

    if (removed.length > 0) {
      major.push(`fields removed: ${removed.join(", ")}`);
    }
    if (added.length > 0) {
      minor.push(`fields added: ${added.join(", ")}`);
    }

    for (const key of prev.keys) {
      if (!nextKeys.has(key)) continue;
      const wasRequired = prevRequired.has(key);
      const nowRequired = nextRequired.has(key);
      if (wasRequired && !nowRequired) {
        minor.push(`field optionalized: ${key}`);
      } else if (!wasRequired && nowRequired) {
        major.push(`field required: ${key}`);
      }
    }

    return { major, minor };
  }

  if (prev.type === "enum" && next.type === "enum") {
    const prevValues = new Set(prev.values.map(String));
    const nextValues = new Set(next.values.map(String));
    const removed = prev.values.filter((v) => !nextValues.has(String(v)));
    const added = next.values.filter((v) => !prevValues.has(String(v)));
    return {
      major: removed.length > 0 ? [`enum values removed: ${removed.join(", ")}`] : [],
      minor: added.length > 0 ? [`enum values added: ${added.join(", ")}`] : [],
    };
  }

  if (prev.type === "literal" && next.type === "literal") {
    if (prev.value !== next.value) {
      return { major: [`literal changed: ${String(prev.value)} -> ${String(next.value)}`], minor: [] };
    }
  }

  if (prev.type === "other" && next.type === "other") {
    if (prev.typeName !== next.typeName) {
      return { major: [`schema changed: ${prev.typeName ?? "unknown"} -> ${next.typeName ?? "unknown"}`], minor: [] };
    }
  }

  return { major: [], minor: [] };
}

export function diffContractRegistry(
  prev: ContractRegistry,
  next: ContractRegistry
): ContractRegistryDiff {
  const prevMap = new Map(prev.contracts.map((c) => [c.id, c]));
  const nextMap = new Map(next.contracts.map((c) => [c.id, c]));

  const added: ContractRegistryEntry[] = [];
  const removed: ContractRegistryEntry[] = [];
  const changed: ContractRegistryChange[] = [];

  for (const [id, nextEntry] of nextMap.entries()) {
    const prevEntry = prevMap.get(id);
    if (!prevEntry) {
      added.push(nextEntry);
      continue;
    }

    const changes: string[] = [];
    let severity: ContractRegistryChange["severity"] = "patch";

    const methodDiff = diffArray(prevEntry.methods, nextEntry.methods);
    if (methodDiff.removed.length > 0) {
      changes.push(`methods removed: ${methodDiff.removed.join(", ")}`);
      severity = "major";
    }
    if (methodDiff.added.length > 0) {
      changes.push(`methods added: ${methodDiff.added.join(", ")}`);
      if (severity !== "major") severity = "minor";
    }

    const responseDiff = diffArray(prevEntry.response, nextEntry.response);
    if (responseDiff.removed.length > 0) {
      changes.push(`responses removed: ${responseDiff.removed.join(", ")}`);
      severity = "major";
    }
    if (responseDiff.added.length > 0) {
      changes.push(`responses added: ${responseDiff.added.join(", ")}`);
      if (severity !== "major") severity = "minor";
    }

    const requestDiff = diffRequestShapes(prevEntry.request, nextEntry.request);
    if (requestDiff.major.length > 0) {
      changes.push(...requestDiff.major);
      severity = "major";
    }
    if (requestDiff.minor.length > 0) {
      changes.push(...requestDiff.minor);
      if (severity !== "major") severity = "minor";
    }

    const prevReqSchemas = prevEntry.schemas?.request ?? {};
    const nextReqSchemas = nextEntry.schemas?.request ?? {};
    for (const method of Object.keys(prevReqSchemas)) {
      if (!nextReqSchemas[method]) continue;
      const prevParts = prevReqSchemas[method] ?? {};
      const nextParts = nextReqSchemas[method] ?? {};
      for (const part of ["query", "body", "params", "headers"] as const) {
        if (!prevParts[part] || !nextParts[part]) continue;
        const diff = diffSchemaSummary(prevParts[part], nextParts[part]);
        if (diff.major.length > 0) {
          changes.push(...diff.major.map((msg) => `${method}.${part}: ${msg}`));
          severity = "major";
        }
        if (diff.minor.length > 0) {
          changes.push(...diff.minor.map((msg) => `${method}.${part}: ${msg}`));
          if (severity !== "major") severity = "minor";
        }
      }
    }

    const prevResSchemas = prevEntry.schemas?.response ?? {};
    const nextResSchemas = nextEntry.schemas?.response ?? {};
    for (const [code, prevSchema] of Object.entries(prevResSchemas)) {
      const status = Number(code);
      const nextSchema = nextResSchemas[status];
      if (!nextSchema) continue;
      const diff = diffSchemaSummary(prevSchema, nextSchema);
      if (diff.major.length > 0) {
        changes.push(...diff.major.map((msg) => `response.${status}: ${msg}`));
        severity = "major";
      }
      if (diff.minor.length > 0) {
        changes.push(...diff.minor.map((msg) => `response.${status}: ${msg}`));
        if (severity !== "major") severity = "minor";
      }
    }

    if (prevEntry.description !== nextEntry.description) {
      changes.push("description changed");
    }
    if (JSON.stringify(prevEntry.tags ?? []) !== JSON.stringify(nextEntry.tags ?? [])) {
      changes.push("tags changed");
    }
    if (prevEntry.version !== nextEntry.version) {
      changes.push("version changed");
    }
    if (prevEntry.hash !== nextEntry.hash && changes.length === 0) {
      changes.push("contract content changed");
    }

    if (changes.length > 0) {
      changed.push({
        id,
        routeId: nextEntry.routeId,
        severity,
        changes,
        before: prevEntry,
        after: nextEntry,
      });
    }
  }

  for (const [id, prevEntry] of prevMap.entries()) {
    if (!nextMap.has(id)) {
      removed.push(prevEntry);
    }
  }

  const summary = {
    major: changed.filter((c) => c.severity === "major").length + removed.length,
    minor: changed.filter((c) => c.severity === "minor").length + added.length,
    patch: changed.filter((c) => c.severity === "patch").length,
  };

  return { added, removed, changed, summary };
}
