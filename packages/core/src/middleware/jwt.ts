/**
 * JWT Middleware Plugin
 * filling.use(jwt({ secret: process.env.JWT_SECRET }))
 */

import type { ManduContext } from "../filling/context";

export interface JwtMiddlewareOptions {
  /** JWT 시크릿 키 */
  secret: string;
  /** 허용할 알고리즘 (기본: ["HS256"]) */
  algorithms?: ("HS256" | "HS384" | "HS512")[];
  /** 토큰 추출 위치 (기본: Authorization 헤더) */
  extractFrom?: "header" | "cookie";
  /** 쿠키 이름 (extractFrom: "cookie" 일 때) */
  cookieName?: string;
  /** ctx.set()에 저장할 키 (기본: "user") */
  storeAs?: string;
}

/**
 * JWT 인증 미들웨어
 *
 * @example
 * ```typescript
 * import { jwt } from "@mandujs/core/middleware";
 *
 * export default Mandu.filling()
 *   .use(jwt({ secret: process.env.JWT_SECRET! }))
 *   .get((ctx) => {
 *     const user = ctx.get("user");
 *     return ctx.ok({ user });
 *   });
 * ```
 */
export function jwt(options: JwtMiddlewareOptions) {
  const { secret, algorithms = ["HS256"], extractFrom = "header", cookieName = "token", storeAs = "user" } = options;

  return async (ctx: ManduContext): Promise<Response | void> => {
    let token: string | null = null;

    if (extractFrom === "header") {
      const auth = ctx.headers.get("Authorization");
      if (auth?.startsWith("Bearer ")) {
        token = auth.slice(7);
      }
    } else {
      token = ctx.cookies.get(cookieName) ?? null;
    }

    if (!token) {
      return ctx.unauthorized("Missing authentication token");
    }

    // 토큰 크기 제한 (메모리 소모 공격 방지)
    if (token.length > 8192) {
      return ctx.unauthorized("Token too large");
    }

    try {
      // Bun native JWT verification
      const payload = await verifyJwtToken(token, secret, algorithms);
      ctx.set(storeAs, payload);
    } catch {
      return ctx.unauthorized("Invalid or expired token");
    }
  };
}

const ALG_MAP: Record<string, string> = {
  HS256: "SHA-256",
  HS384: "SHA-384",
  HS512: "SHA-512",
};

/** JWT 검증 (Bun crypto 기반, HS256/HS384/HS512 지원) */
async function verifyJwtToken(
  token: string,
  secret: string,
  allowedAlgorithms: string[]
): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const [headerB64, payloadB64, signatureB64] = parts;

  // 헤더에서 알고리즘 확인
  const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
  const alg = header.alg as string;
  if (!allowedAlgorithms.includes(alg)) {
    throw new Error(`Algorithm "${alg}" not allowed. Allowed: ${allowedAlgorithms.join(", ")}`);
  }

  const hash = ALG_MAP[alg];
  if (!hash) throw new Error(`Unsupported algorithm: ${alg}`);

  // 서명 검증
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash },
    false,
    ["verify"]
  );

  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);

  const valid = await crypto.subtle.verify("HMAC", key, signature as BufferSource, data);
  if (!valid) throw new Error("Invalid signature");

  // 페이로드 디코딩
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));

  // 만료 확인
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error("Token expired");
  }

  return payload;
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
