/**
 * Phase C.3 — RPC parity for ATE.
 *
 * Scans the repo for `defineRpc({...})` invocations (from
 * `@mandujs/core/contract/rpc`) and produces a list of `rpc_procedure`
 * nodes + `rpc_endpoint` nodes analogous to the route extractor in
 * Phase A.1.
 *
 * Scope: REST-route-first tooling (context, coverage, boundary) needed
 * a missing shape for RPC — this module fills it so `mandu_ate_context`
 * can return `{ scope: "rpc", id: "users.signup" }` cleanly.
 *
 * Boundary probe works "for free" because Zod schemas are identical —
 * the boundary module takes a Zod expression at source text level and
 * never cares whether it came from a REST contract or an RPC
 * procedure.
 *
 * Spec: docs/ate/phase-c-spec.md §C.3.
 */
import fg from "fast-glob";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  SourceFile,
  SyntaxKind as SyntaxKindEnum,
  Node as TsmNode,
} from "ts-morph";

export interface RpcProcedureNode {
  /** Dot-notation id — "<endpoint>.<procedure>". */
  id: string;
  /** Endpoint key (the registry name). */
  endpoint: string;
  /** Procedure key within the endpoint. */
  procedure: string;
  /** Absolute-ish repo-relative POSIX path to the file declaring the RPC. */
  file: string;
  /** Source line (1-based) of the procedure literal. */
  line: number;
  /** Zod expression for the procedure input, as raw source text. */
  inputSchemaSource?: string;
  /** Zod expression for the procedure output, as raw source text. */
  outputSchemaSource: string;
  /** Middleware chain extracted from the same file — best effort. */
  middlewareNames: string[];
  /** HTTP mount path — `/api/rpc/<endpoint>/<procedure>`. */
  mountPath: string;
}

export interface RpcEndpointNode {
  /** Endpoint registry name (used in `/api/rpc/<endpoint>/...`). */
  endpoint: string;
  file: string;
  line: number;
  procedureIds: string[];
}

export interface RpcExtractionResult {
  endpoints: RpcEndpointNode[];
  procedures: RpcProcedureNode[];
  /** Files scanned. */
  scannedFiles: number;
}

/**
 * Walk the repo for `defineRpc(...)` calls, extract procedures.
 *
 * Discovery: files under app-dir, src-dir, package rpc modules, and the
 * conventional `*.rpc.ts` suffix. Any TS file that mentions `defineRpc`
 * is a candidate. We use fast-glob with default excludes (node_modules
 * / .mandu / dist).
 */
export async function extractRpcProcedures(repoRoot: string): Promise<RpcExtractionResult> {
  const files = await fg(
    [
      "app/**/*.ts",
      "app/**/*.tsx",
      "src/**/*.ts",
      "src/**/*.tsx",
      "packages/**/src/**/*.ts",
      "rpc/**/*.ts",
      "**/*.rpc.ts",
    ],
    {
      cwd: repoRoot,
      absolute: true,
      ignore: ["**/node_modules/**", "**/.mandu/**", "**/dist/**", "**/build/**", "**/tests/**", "**/__tests__/**"],
    },
  );

  // Quick gate: only pay for ts-morph on files that mention `defineRpc`.
  const candidates: string[] = [];
  for (const abs of files) {
    try {
      const src = readFileSync(abs, "utf8");
      if (src.includes("defineRpc")) candidates.push(abs);
    } catch {
      // skip unreadable
    }
  }

  if (candidates.length === 0) {
    return { endpoints: [], procedures: [], scannedFiles: files.length };
  }

  const { Project, SyntaxKind } = await import("ts-morph");
  const project = new Project();
  const procedures: RpcProcedureNode[] = [];
  const endpointsByName = new Map<string, RpcEndpointNode>();

  for (const abs of candidates) {
    let sf: SourceFile;
    try {
      sf = project.addSourceFileAtPath(abs);
    } catch {
      continue;
    }
    const rel = relative(repoRoot, abs).replace(/\\/g, "/");
    const middleware = scanMiddlewareLike(sf, SyntaxKind);

    // Collect every `defineRpc({...})` call.
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const callExpr = call as unknown as { getExpression(): TsmNode; getArguments(): TsmNode[]; getStartLineNumber(): number; getParent(): TsmNode | undefined };
      if (callExpr.getExpression().getText() !== "defineRpc") continue;
      const args = callExpr.getArguments();
      if (args.length === 0) continue;
      const procRecord = args[0];
      if (procRecord.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

      // Derive endpoint name from the declaration.
      const endpointName = deriveEndpointName(call as unknown as TsmNode, SyntaxKind) ?? "rpc";
      const endpoint: RpcEndpointNode = endpointsByName.get(endpointName) ?? {
        endpoint: endpointName,
        file: rel,
        line: callExpr.getStartLineNumber(),
        procedureIds: [],
      };
      endpointsByName.set(endpointName, endpoint);

      // Walk the properties of the procedures record.
      const props = (procRecord as unknown as { getProperties(): TsmNode[] }).getProperties();
      for (const prop of props) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const p = prop as unknown as {
          getNameNode(): TsmNode;
          getInitializer(): TsmNode | undefined;
          getStartLineNumber(): number;
        };
        const procName = p.getNameNode().getText().replace(/^['"]|['"]$/g, "");
        const init = p.getInitializer();
        if (!init || init.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

        // Walk the procedure's { input, output, handler } members.
        const inner = (init as unknown as { getProperties(): TsmNode[] }).getProperties();
        let inputSrc: string | undefined;
        let outputSrc: string | undefined;
        for (const m of inner) {
          if (m.getKind() !== SyntaxKind.PropertyAssignment) continue;
          const mm = m as unknown as {
            getNameNode(): TsmNode;
            getInitializer(): TsmNode | undefined;
          };
          const key = mm.getNameNode().getText().replace(/^['"]|['"]$/g, "");
          const valNode = mm.getInitializer();
          if (!valNode) continue;
          if (key === "input") inputSrc = valNode.getText();
          else if (key === "output") outputSrc = valNode.getText();
        }
        if (!outputSrc) continue; // ill-formed procedure — skip

        const id = `${endpointName}.${procName}`;
        endpoint.procedureIds.push(id);
        procedures.push({
          id,
          endpoint: endpointName,
          procedure: procName,
          file: rel,
          line: p.getStartLineNumber(),
          ...(inputSrc ? { inputSchemaSource: inputSrc } : {}),
          outputSchemaSource: outputSrc,
          middlewareNames: middleware,
          mountPath: `/api/rpc/${endpointName}/${procName}`,
        });
      }
    }
  }

  return {
    endpoints: [...endpointsByName.values()],
    procedures,
    scannedFiles: files.length,
  };
}

/**
 * Walk up from the `defineRpc(...)` call to find a `const <X> = ...`
 * declaration and use `<X>` as the endpoint name, falling back to a
 * sibling `registerRpc("name", ...)` call.
 */
function deriveEndpointName(
  callNode: TsmNode,
  SK: typeof SyntaxKindEnum,
): string | null {
  // Walk up through parents looking for a VariableDeclaration.
  let cursor: TsmNode | undefined = callNode as unknown as TsmNode & { getParent(): TsmNode | undefined };
  while (cursor) {
    if (cursor.getKind() === SK.VariableDeclaration) {
      const vd = cursor as unknown as { getNameNode(): TsmNode };
      const name = vd.getNameNode().getText();
      // Strip trailing "Rpc" / "RPC" suffix for nicer endpoint names.
      return name.replace(/Rpc$|RPC$/, "").replace(/^./, (c) => c.toLowerCase());
    }
    cursor = (cursor as unknown as { getParent(): TsmNode | undefined }).getParent();
  }
  return null;
}

function scanMiddlewareLike(sf: SourceFile, SK: typeof SyntaxKindEnum): string[] {
  const calls = sf.getDescendantsOfKind(SK.CallExpression);
  const names = new Set<string>();
  for (const c of calls) {
    const expr = (c as unknown as { getExpression(): TsmNode }).getExpression();
    if (expr.getKind() !== SK.PropertyAccessExpression) continue;
    const text = expr.getText();
    if (!text.endsWith(".use")) continue;
    const args = (c as unknown as { getArguments(): TsmNode[] }).getArguments();
    if (args.length === 0) continue;
    const first = args[0];
    // Grab the callee of the first argument if it's a CallExpression —
    // e.g. `builder.use(csrf())` → "csrf".
    if (first.getKind() === SK.CallExpression) {
      const exprInner = (first as unknown as { getExpression(): TsmNode }).getExpression();
      names.add(exprInner.getText());
    } else {
      names.add(first.getText());
    }
  }
  return [...names];
}

// ────────────────────────────────────────────────────────────────────────────
// Context scope="rpc" builder
// ────────────────────────────────────────────────────────────────────────────

export interface RpcContextBlob {
  scope: "rpc";
  found: true;
  graphVersion?: string;
  procedure: {
    id: string;
    endpoint: string;
    procedure: string;
    mountPath: string;
    file: string;
    line: number;
  };
  inputSchemaSource: string | null;
  outputSchemaSource: string;
  middleware: Array<{ name: string; identifier: string }>;
  /** Route-shaped aliases so agents can treat RPC uniformly. */
  routeLike: {
    id: string;
    pattern: string;
    methods: ["POST"];
    kind: "api";
  };
}

export interface RpcContextRequest {
  /** Dot-notation id — "users.signup" or just "signup" (will be matched). */
  id: string;
  /** Optional pre-extracted set so callers can reuse for several queries. */
  result?: RpcExtractionResult;
  repoRoot: string;
}

export async function buildRpcContext(
  request: RpcContextRequest,
): Promise<RpcContextBlob | { scope: "rpc"; found: false; reason: string; suggestions: string[] }> {
  const extracted = request.result ?? (await extractRpcProcedures(request.repoRoot));
  const hit = findProcedure(extracted.procedures, request.id);
  if (!hit) {
    return {
      scope: "rpc",
      found: false,
      reason: `No RPC procedure matches id=${request.id}`,
      suggestions: extracted.procedures.slice(0, 10).map((p) => p.id),
    };
  }

  return {
    scope: "rpc",
    found: true,
    procedure: {
      id: hit.id,
      endpoint: hit.endpoint,
      procedure: hit.procedure,
      mountPath: hit.mountPath,
      file: hit.file,
      line: hit.line,
    },
    inputSchemaSource: hit.inputSchemaSource ?? null,
    outputSchemaSource: hit.outputSchemaSource,
    middleware: hit.middlewareNames.map((n) => ({ name: n, identifier: n })),
    routeLike: {
      id: `rpc-${hit.endpoint}-${hit.procedure}`,
      pattern: hit.mountPath,
      methods: ["POST"],
      kind: "api",
    },
  };
}

function findProcedure(procs: RpcProcedureNode[], id: string): RpcProcedureNode | null {
  if (!id) return null;
  // Full dot-notation match first.
  const hit = procs.find((p) => p.id === id);
  if (hit) return hit;
  // Endpoint + procedure match: "signup" alone — match by procedure name.
  const byProc = procs.filter((p) => p.procedure === id);
  if (byProc.length === 1) return byProc[0];
  // "users.signup" without the endpoint prefix matching — try suffix match.
  const suffix = procs.find((p) => p.id.endsWith(`.${id}`));
  return suffix ?? null;
}
