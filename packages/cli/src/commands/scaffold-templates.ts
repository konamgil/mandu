/**
 * Scaffold templates — string constants for generated boilerplate files.
 */

export type MiddlewarePreset = "default" | "jwt" | "all";

export const MIDDLEWARE_TEMPLATE = `\
/**
 * Middleware — runs before each request.
 *
 * Export a default function that receives (request, next).
 * Call next() to continue, or return a Response to short-circuit.
 */

export default async function middleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  // Example: basic auth check
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/admin")) {
    const auth = request.headers.get("Authorization");
    if (!auth) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  return next();
}
`;

const JWT_MIDDLEWARE_TEMPLATE = `\
/**
 * JWT middleware scaffold.
 *
 * Protect routes by checking for a Bearer token.
 * Replace verifyToken() with your own auth logic.
 */

async function verifyToken(token: string): Promise<boolean> {
  return token.length > 10;
}

export default async function middleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const needsAuth = url.pathname.startsWith("/api");

  if (!needsAuth) {
    return next();
  }

  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token || !(await verifyToken(token))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return next();
}
`;

const ALL_MIDDLEWARE_TEMPLATE = `\
/**
 * Middleware preset: cors + logger + jwt placeholder.
 *
 * Adjust allowed origins and token validation before production use.
 */

const ALLOWED_ORIGINS = new Set(["http://localhost:3333"]);

async function verifyToken(token: string): Promise<boolean> {
  return token.length > 10;
}

export default async function middleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders = origin && ALLOWED_ORIGINS.has(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      }
    : {};

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startedAt = Date.now();
  const url = new URL(request.url);
  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (url.pathname.startsWith("/api") && (!token || !(await verifyToken(token)))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const response = await next();
  const elapsed = Date.now() - startedAt;
  console.log(\`[middleware] \${request.method} \${url.pathname} \${response.status} (\${elapsed}ms)\`);

  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}
`;

export function normalizeMiddlewarePreset(value?: string): MiddlewarePreset | null {
  if (!value) return "default";

  switch (value.toLowerCase()) {
    case "default":
    case "basic":
      return "default";
    case "jwt":
      return "jwt";
    case "all":
      return "all";
    default:
      return null;
  }
}

export function getMiddlewareTemplate(preset?: string): string | null {
  const normalized = normalizeMiddlewarePreset(preset);
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case "jwt":
      return JWT_MIDDLEWARE_TEMPLATE;
    case "all":
      return ALL_MIDDLEWARE_TEMPLATE;
    default:
      return MIDDLEWARE_TEMPLATE;
  }
}

export function wsTemplate(name: string): string {
  return `\
/**
 * WebSocket route — /api/${name}
 *
 * Handles upgrade and message events.
 */

import type { ServerWebSocket } from "bun";

export function GET(request: Request): Response {
  const upgraded = Bun.upgradeWebSocket(request, { data: {} });
  if (!upgraded) {
    return new Response("WebSocket upgrade failed", { status: 400 });
  }
  return upgraded.response;
}

export const websocket = {
  open(ws: ServerWebSocket) {
    console.log("[${name}] client connected");
  },
  message(ws: ServerWebSocket, message: string | Buffer) {
    // Echo back by default
    ws.send(typeof message === "string" ? message : message.toString());
  },
  close(ws: ServerWebSocket) {
    console.log("[${name}] client disconnected");
  },
};
`;
}

export const SESSION_TEMPLATE = `\
/**
 * Cookie-based session storage.
 *
 * Uses a simple signed-cookie approach.
 * Replace SESSION_SECRET with a strong value in production.
 */

const SESSION_SECRET = process.env.SESSION_SECRET ?? "mandu-dev-secret";

export interface SessionData {
  [key: string]: unknown;
}

/**
 * Read session data from the request cookies.
 */
export async function getSession(request: Request): Promise<SessionData> {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/mandu_session=([^;]+)/);
  if (!match) return {};

  try {
    const [payload, signature] = decodeURIComponent(match[1]).split(".");
    if (!payload || !signature) return {};

    // HMAC 서명 검증
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, Uint8Array.from(atob(signature), c => c.charCodeAt(0)), encoder.encode(payload));
    if (!valid) return {};

    return JSON.parse(atob(payload)) as SessionData;
  } catch {
    return {};
  }
}

/**
 * Serialize session data into a signed Set-Cookie header value.
 */
export async function commitSession(data: SessionData): Promise<string> {
  const payload = btoa(JSON.stringify(data));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const value = encodeURIComponent(\`\${payload}.\${signature}\`);
  return \`mandu_session=\${value}; Path=/; HttpOnly; SameSite=Lax\`;
}

/**
 * Destroy session (expire cookie).
 */
export function destroySession(): string {
  return "mandu_session=; Path=/; HttpOnly; Max-Age=0";
}
`;
