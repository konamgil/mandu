import { ensureEnvExampleEntries, writeFileIfMissing } from "../util/scaffold-files";

export interface AuthInitOptions {
  strategy?: string;
}

function normalizeStrategy(value?: string): "jwt" | null {
  if (!value) return "jwt";

  switch (value.toLowerCase()) {
    case "jwt":
    case "token":
      return "jwt";
    default:
      return null;
  }
}

const AUTH_TEMPLATE = `\
import { createAuthGuard, type BaseUser, type CookieOptions } from "@mandujs/core";

export interface AuthUser extends BaseUser {
  email: string;
  name: string;
  role: "user" | "admin";
}

export const AUTH_COOKIE_NAME = "auth_token";
const JWT_SECRET = process.env.JWT_SECRET ?? "mandu-dev-jwt-secret";
const AUTH_TOKEN_TTL = 60 * 60 * 24 * 7;

const DEMO_USERS = new Map<string, { password: string; user: AuthUser }>([
  [
    "admin@example.com",
    {
      password: "changeme123",
      user: {
        id: "user_admin",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
      },
    },
  ],
]);

export function getAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    maxAge: AUTH_TOKEN_TTL,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const record = DEMO_USERS.get(email.trim().toLowerCase());
  if (!record || record.password !== password) {
    return null;
  }

  return { ...record.user };
}

export async function registerUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthUser> {
  return {
    id: crypto.randomUUID(),
    email: input.email.trim().toLowerCase(),
    name: input.name?.trim() || "New User",
    role: "user",
  };
}

export async function issueToken(user: AuthUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      ...user,
      iat: now,
      exp: now + AUTH_TOKEN_TTL,
    }),
  );
  const body = \`\${header}.\${payload}\`;
  const signature = await signToken(body);
  return \`\${body}.\${signature}\`;
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const body = \`\${header}.\${payload}\`;
  const expected = await signToken(body);
  if (signature !== expected) return null;

  try {
    const decoded = JSON.parse(decodeBase64Url(payload)) as Partial<AuthUser> & { exp?: number };
    if (!decoded.id || !decoded.email || !decoded.name || !decoded.role) {
      return null;
    }
    if (typeof decoded.exp === "number" && decoded.exp * 1000 < Date.now()) {
      return null;
    }

    return {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}

export async function verifyAuthRequest(request: Request): Promise<AuthUser | null> {
  const cookieToken = readCookie(request.headers.get("cookie"), AUTH_COOKIE_NAME);
  const header = request.headers.get("authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const token = cookieToken ?? bearerToken;

  if (!token) {
    return null;
  }

  return verifyToken(token);
}

export const authGuard = createAuthGuard<AuthUser>(async (ctx) => {
  return verifyAuthRequest(ctx.request);
});

async function signToken(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return encodeBytesBase64Url(new Uint8Array(signature));
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

function encodeBase64Url(value: string): string {
  return encodeBytesBase64Url(new TextEncoder().encode(value));
}

function encodeBytesBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\\+/g, "-")
    .replace(/\\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}
`;

const AUTH_MIDDLEWARE_TEMPLATE = `\
import { verifyAuthRequest } from "./src/server/auth";

const PROTECTED_PREFIXES = ["/api/private"];

export default async function middleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const needsAuth = PROTECTED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));

  if (!needsAuth || url.pathname.startsWith("/api/auth")) {
    return next();
  }

  const user = await verifyAuthRequest(request);
  if (!user) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  return next();
}
`;

const LOGIN_ROUTE_TEMPLATE = `\
import { Mandu } from "@mandujs/core";
import {
  AUTH_COOKIE_NAME,
  authenticateUser,
  getAuthCookieOptions,
  issueToken,
} from "../../../../src/server/auth";

interface LoginBody {
  email?: string;
  password?: string;
}

export default Mandu.filling().post(async (ctx) => {
  const body = await ctx.body<LoginBody>();

  if (!body.email || !body.password) {
    return ctx.error("email and password are required");
  }

  const user = await authenticateUser(body.email, body.password);
  if (!user) {
    return ctx.unauthorized("Invalid email or password");
  }

  const token = await issueToken(user);
  ctx.cookies.set(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

  return ctx.ok({
    ok: true,
    user,
  });
});
`;

const REGISTER_ROUTE_TEMPLATE = `\
import { Mandu } from "@mandujs/core";
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  issueToken,
  registerUser,
} from "../../../../src/server/auth";

interface RegisterBody {
  email?: string;
  password?: string;
  name?: string;
}

export default Mandu.filling().post(async (ctx) => {
  const body = await ctx.body<RegisterBody>();

  if (!body.email || !body.password) {
    return ctx.error("email and password are required");
  }

  if (body.password.length < 8) {
    return ctx.error("password must be at least 8 characters");
  }

  const user = await registerUser(body);
  const token = await issueToken(user);
  ctx.cookies.set(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

  return ctx.created({
    ok: true,
    user,
  });
});
`;

const LOGOUT_ROUTE_TEMPLATE = `\
import { Mandu } from "@mandujs/core";
import { AUTH_COOKIE_NAME } from "../../../../src/server/auth";

export default Mandu.filling().post((ctx) => {
  ctx.cookies.delete(AUTH_COOKIE_NAME, { path: "/" });

  return ctx.ok({
    ok: true,
  });
});
`;

export async function authInit(options: AuthInitOptions = {}): Promise<boolean> {
  const strategy = normalizeStrategy(options.strategy);
  if (!strategy) {
    console.error(`Unknown auth strategy: ${options.strategy}`);
    console.error("Available strategies: jwt");
    return false;
  }

  const cwd = process.cwd();
  const results = await Promise.all([
    writeFileIfMissing(cwd, "src/server/auth.ts", AUTH_TEMPLATE),
    writeFileIfMissing(cwd, "app/api/auth/login/route.ts", LOGIN_ROUTE_TEMPLATE),
    writeFileIfMissing(cwd, "app/api/auth/register/route.ts", REGISTER_ROUTE_TEMPLATE),
    writeFileIfMissing(cwd, "app/api/auth/logout/route.ts", LOGOUT_ROUTE_TEMPLATE),
    writeFileIfMissing(cwd, "middleware.ts", AUTH_MIDDLEWARE_TEMPLATE),
  ]);
  const envResult = await ensureEnvExampleEntries(cwd, {
    JWT_SECRET: "change-me-in-production",
  });

  for (const result of results) {
    const verb = result.created ? "Created" : "Skipped existing";
    console.log(`${verb} ${result.displayPath}`);
  }

  if (envResult.addedKeys.length > 0) {
    console.log(`Updated ${envResult.displayPath} (${envResult.addedKeys.join(", ")})`);
  } else {
    console.log(`${envResult.displayPath} already contains JWT_SECRET`);
  }

  console.log("\nNext steps:");
  console.log("  - Replace the demo user logic in src/server/auth.ts with your database or identity provider.");
  console.log("  - Set JWT_SECRET in your local .env before production use.");
  console.log("  - Edit middleware.ts to protect the routes you actually want to guard.");
  return true;
}
