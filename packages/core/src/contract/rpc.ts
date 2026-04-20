/**
 * Mandu Typed RPC — Server Side
 *
 * tRPC-like end-to-end typed RPC built on Mandu's existing contract +
 * client layer. No external tRPC dependency. Zod contracts on the
 * server flow through to auto-typed client proxies.
 *
 * Phase 18.κ — see `docs/architect/typed-rpc.md` for the comparison
 * against tRPC / SvelteKit form actions / Next.js server actions plus
 * the migration recipe.
 *
 * @module
 */

import type { z } from "zod";

// ========== Types ==========

/**
 * Per-procedure call context.
 *
 * `input` is the Zod-parsed, validated request body (or `undefined`
 * when the procedure declares no `input` schema). `request` is the
 * raw Fetch `Request` so procedures can read cookies / headers. `ctx`
 * is a free-form object threaded from the dispatcher — Phase 18.κ
 * ships an empty object by default; session / DB / user wiring is
 * layered on via `ManduConfig.rpc.context` in a future patch.
 */
export interface RpcContext<TInput = unknown, TCtx = Record<string, unknown>> {
  /** Validated input (parsed by the procedure's `input` Zod schema). */
  input: TInput;
  /** Raw Fetch Request — cookies / headers / auth state. */
  request: Request;
  /** Per-request context (session, db, user, …). */
  ctx: TCtx;
}

/**
 * A single RPC procedure definition.
 *
 * Each procedure pairs an `input` schema (optional — allow
 * parameter-less RPCs), an `output` schema (required — the contract
 * guarantee), and a `handler` function. `handler` receives the
 * validated input + the raw Request + a shared context object and
 * returns the output shape; the dispatcher validates the return
 * value against `output` before shipping.
 */
export interface RpcProcedure<
  TInputSchema extends z.ZodTypeAny | undefined = z.ZodTypeAny | undefined,
  TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TCtx extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Zod schema for procedure input. `undefined` for no-arg procedures. */
  input?: TInputSchema;
  /** Zod schema for the return value (response body). */
  output: TOutputSchema;
  /** Procedure body. Receives validated input + request + shared ctx. */
  handler: (
    args: RpcContext<
      TInputSchema extends z.ZodTypeAny ? z.infer<TInputSchema> : undefined,
      TCtx
    >
  ) => Promise<z.infer<TOutputSchema>> | z.infer<TOutputSchema>;
}

/** Record of procedures — the raw user input to {@link defineRpc}. */
export type RpcProcedureRecord = Record<
  string,
  RpcProcedure<z.ZodTypeAny | undefined, z.ZodTypeAny>
>;

/**
 * Tagged RPC definition — the return value of {@link defineRpc}.
 *
 * The `__rpc` brand lets the client proxy and the route dispatcher
 * distinguish RPC definitions from plain contract objects without
 * reaching for `instanceof`.
 */
export interface RpcDefinition<TProcedures extends RpcProcedureRecord = RpcProcedureRecord> {
  /** The raw procedure record (used by both server dispatch and client proxy). */
  procedures: TProcedures;
  /** Brand — distinguishes RPC defs from contract objects. */
  readonly __rpc: true;
}

/**
 * Client-facing type derived from a {@link RpcDefinition}.
 *
 * Maps each procedure key to a function whose argument is the Zod
 * input type (or `undefined`/no-arg for procedures without input)
 * and whose return is `Promise<Output>`. Used by
 * `createRpcClient<typeof postsRpc>()`.
 */
export type RpcClient<TDef extends RpcDefinition<RpcProcedureRecord>> = {
  [K in keyof TDef["procedures"]]: TDef["procedures"][K]["input"] extends z.ZodTypeAny
    ? (input: z.infer<TDef["procedures"][K]["input"]>) => Promise<z.infer<TDef["procedures"][K]["output"]>>
    : (input?: undefined) => Promise<z.infer<TDef["procedures"][K]["output"]>>;
};

// ========== Core API ==========

/**
 * Define a tRPC-style typed RPC module.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { defineRpc } from "@mandujs/core/contract/rpc";
 *
 * export const postsRpc = defineRpc({
 *   list: {
 *     input: z.object({ limit: z.number().optional() }).optional(),
 *     output: z.array(z.object({ id: z.string(), title: z.string() })),
 *     handler: async ({ input }) => db.posts.findMany({ limit: input?.limit ?? 10 }),
 *   },
 *   get: {
 *     input: z.object({ id: z.string() }),
 *     output: z.object({ id: z.string(), title: z.string(), body: z.string() }),
 *     handler: async ({ input }) => db.posts.findUnique({ where: { id: input.id } }),
 *   },
 * });
 * ```
 *
 * Wire to a server by passing to {@link registerRpc} (or via
 * `ManduConfig.rpc.endpoints`). Requests resolve to
 * `POST /api/rpc/<name>/<method>` where `<name>` is the endpoint key.
 */
export function defineRpc<TProcedures extends RpcProcedureRecord>(
  procedures: TProcedures
): RpcDefinition<TProcedures> {
  // Validate each procedure shape at define-time so a missing `output`
  // or `handler` fails fast with a readable message instead of a
  // runtime NPE inside the dispatcher.
  for (const [key, proc] of Object.entries(procedures)) {
    if (!proc || typeof proc !== "object") {
      throw new Error(
        `[Mandu RPC] Procedure "${key}" is not an object. Each procedure must be { input?, output, handler }.`
      );
    }
    if (typeof proc.handler !== "function") {
      throw new Error(
        `[Mandu RPC] Procedure "${key}" is missing a handler function.`
      );
    }
    if (!proc.output || typeof (proc.output as z.ZodTypeAny).safeParse !== "function") {
      throw new Error(
        `[Mandu RPC] Procedure "${key}" is missing an output Zod schema.`
      );
    }
    if (proc.input !== undefined && typeof (proc.input as z.ZodTypeAny).safeParse !== "function") {
      throw new Error(
        `[Mandu RPC] Procedure "${key}" has an invalid input schema (not a Zod type).`
      );
    }
  }

  return {
    procedures,
    __rpc: true,
  };
}

// ========== Registry ==========

/**
 * Global RPC endpoint registry.
 *
 * Keyed by endpoint name (the `<name>` in `/api/rpc/<name>/<method>`).
 * Populated by {@link registerRpc} (typically at boot via
 * `ManduConfig.rpc.endpoints`) and consumed by the dispatcher in
 * `runtime/server.ts`.
 */
const rpcRegistry = new Map<string, RpcDefinition<RpcProcedureRecord>>();

/**
 * Register an RPC endpoint under `name`.
 *
 * Same name twice overwrites (HMR-friendly). Pass `null` / `undefined`
 * to clear a registration. Typically called automatically from
 * `startServer` when `ManduConfig.rpc.endpoints` is set, but public
 * so user code can register additional endpoints at runtime.
 */
export function registerRpc(
  name: string,
  definition: RpcDefinition<RpcProcedureRecord>
): void {
  if (!definition?.__rpc) {
    throw new Error(
      `[Mandu RPC] registerRpc("${name}", …) expected a defineRpc() result, got ${typeof definition}.`
    );
  }
  rpcRegistry.set(name, definition);
}

/** Look up an RPC endpoint by name. Returns `undefined` on miss. */
export function getRpc(name: string): RpcDefinition<RpcProcedureRecord> | undefined {
  return rpcRegistry.get(name);
}

/** Clear all RPC registrations (test helper). */
export function clearRpcRegistry(): void {
  rpcRegistry.clear();
}

/** Enumerate registered endpoint names. */
export function listRpcEndpoints(): string[] {
  return Array.from(rpcRegistry.keys());
}

// ========== Dispatch ==========

/**
 * Shape of the JSON envelope that flows over the wire.
 *
 * Mirrors {@link RpcWireError} for the failure case — the client
 * proxy inspects `ok` and unwraps `data` or throws {@link RpcCallError}.
 */
export type RpcWireEnvelope<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: RpcWireError };

export interface RpcWireError {
  /** Machine-readable code: `INPUT_INVALID` | `OUTPUT_INVALID` | `NOT_FOUND` | `HANDLER_ERROR` | `METHOD_NOT_ALLOWED` | `BAD_JSON`. */
  code: string;
  /** Human-readable message (generic in prod, full in dev). */
  message: string;
  /** Optional field-level issues for `INPUT_INVALID` / `OUTPUT_INVALID`. */
  issues?: Array<{ path: (string | number)[]; message: string; code?: string }>;
}

/**
 * Match `/api/rpc/<name>/<method>` — the canonical RPC URL shape.
 * Returns `null` for any path that is not an RPC call, so the
 * dispatcher can fall through to the normal route matcher.
 *
 * `<name>` and `<method>` are restricted to `[A-Za-z0-9_-]+` to
 * prevent path-traversal style abuse of the lookup key.
 */
export function matchRpcPath(
  pathname: string
): { endpoint: string; method: string } | null {
  if (!pathname.startsWith("/api/rpc/")) return null;
  const rest = pathname.slice("/api/rpc/".length);
  // Only two non-empty segments; reject nested paths.
  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  const [endpoint, method] = parts;
  if (!endpoint || !method) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(endpoint)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(method)) return null;
  return { endpoint, method };
}

/**
 * Serialize a Zod error to the wire-level `issues` array.
 */
function zodIssues(err: z.ZodError): RpcWireError["issues"] {
  return err.errors.map((iss) => ({
    path: iss.path,
    message: iss.message,
    code: iss.code,
  }));
}

function jsonResponse(envelope: RpcWireEnvelope, status: number): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Dispatch an RPC call.
 *
 * Handles (in order): method gate (POST only), endpoint lookup,
 * procedure lookup, input parse + validate, handler invocation,
 * output validate, response shaping. Every failure path returns a
 * structured {@link RpcWireEnvelope} — callers do not throw.
 *
 * `isDev` toggles whether handler errors include the raw message +
 * stack. In prod (`isDev === false`) we return a generic
 * `"Internal RPC error"` to avoid leaking stack frames.
 */
export async function dispatchRpc(
  req: Request,
  endpoint: string,
  method: string,
  options: { isDev?: boolean; ctx?: Record<string, unknown> } = {}
): Promise<Response> {
  const isDev = options.isDev ?? false;
  const sharedCtx = options.ctx ?? {};

  if (req.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `RPC endpoints accept POST only (got ${req.method}).`,
        },
      },
      405
    );
  }

  const definition = rpcRegistry.get(endpoint);
  if (!definition) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Unknown RPC endpoint "${endpoint}".`,
        },
      },
      404
    );
  }

  const procedure = definition.procedures[method];
  if (!procedure) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `RPC endpoint "${endpoint}" has no procedure "${method}".`,
        },
      },
      404
    );
  }

  // ---- Parse body ----
  let rawBody: unknown = undefined;
  const contentLength = req.headers.get("content-length");
  const hasBody = contentLength !== "0" && req.headers.get("content-type")?.includes("application/json");
  if (hasBody) {
    try {
      const text = await req.text();
      if (text.length > 0) {
        rawBody = JSON.parse(text);
      }
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "BAD_JSON",
            message: `Request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          },
        },
        400
      );
    }
  }

  // Wire envelope: { input: <value> } — matches createRpcClient output.
  const rawInput = rawBody && typeof rawBody === "object" && rawBody !== null && "input" in rawBody
    ? (rawBody as { input: unknown }).input
    : rawBody;

  // ---- Validate input ----
  let parsedInput: unknown = undefined;
  if (procedure.input) {
    const result = procedure.input.safeParse(rawInput);
    if (!result.success) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "INPUT_INVALID",
            message: "Input failed schema validation.",
            issues: zodIssues(result.error),
          },
        },
        400
      );
    }
    parsedInput = result.data;
  }

  // ---- Invoke handler ----
  let handlerResult: unknown;
  try {
    handlerResult = await procedure.handler({
      input: parsedInput as never,
      request: req,
      ctx: sharedCtx,
    });
  } catch (err) {
    const message =
      isDev && err instanceof Error
        ? err.message
        : "Internal RPC error";
    if (isDev) {
      // Dev mode: surface the stack on the server console so the
      // user can debug without peering at network tab payloads.
      console.error(
        `[Mandu RPC] handler error in ${endpoint}.${method}:`,
        err
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "HANDLER_ERROR",
          message,
        },
      },
      500
    );
  }

  // ---- Validate output ----
  const outResult = procedure.output.safeParse(handlerResult);
  if (!outResult.success) {
    // Output-schema mismatch is a programmer bug (server returned
    // wrong shape). Log loud in dev; return a generic 500 in prod.
    if (isDev) {
      console.error(
        `[Mandu RPC] output validation failed in ${endpoint}.${method}:`,
        outResult.error.errors
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "OUTPUT_INVALID",
          message: isDev
            ? "Handler returned a value that does not match the output schema."
            : "Internal RPC error",
          issues: isDev ? zodIssues(outResult.error) : undefined,
        },
      },
      500
    );
  }

  return jsonResponse({ ok: true, data: outResult.data }, 200);
}
