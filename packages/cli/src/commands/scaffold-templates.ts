/**
 * Scaffold templates — string constants for generated boilerplate files.
 */

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
