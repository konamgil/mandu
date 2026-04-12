/**
 * Mandu Session Storage
 * 쿠키 기반 서버 사이드 세션 관리
 */

import { type CookieManager, type CookieOptions } from "./context";

// ========== Types ==========

export interface SessionData {
  [key: string]: unknown;
}

export interface SessionStorage {
  /** 요청의 쿠키에서 세션 가져오기 */
  getSession(cookies: CookieManager): Promise<Session>;
  /** 세션을 직렬화하여 Set-Cookie 헤더 문자열 반환 */
  commitSession(session: Session): Promise<string>;
  /** 세션 파기 (쿠키 삭제) */
  destroySession(session: Session): Promise<string>;
}

export interface CookieSessionOptions {
  cookie: {
    /** 쿠키 이름 (기본: "__session") */
    name?: string;
    /** HMAC 서명 시크릿 */
    secrets: string[];
    /** 기본 쿠키 옵션 */
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "strict" | "lax" | "none";
    maxAge?: number;
    path?: string;
    domain?: string;
  };
}

// ========== Session Class ==========

export class Session {
  private data: SessionData;
  private flash: Map<string, unknown> = new Map();
  readonly id: string;

  constructor(data: SessionData = {}, id?: string) {
    this.data = { ...data };
    this.id = id ?? crypto.randomUUID();
  }

  get<T = unknown>(key: string): T | undefined {
    // flash 데이터는 한번 읽으면 제거
    if (this.flash.has(key)) {
      const value = this.flash.get(key);
      this.flash.delete(key);
      return value as T;
    }
    return this.data[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }

  has(key: string): boolean {
    return key in this.data || this.flash.has(key);
  }

  unset(key: string): void {
    delete this.data[key];
  }

  /**
   * Flash 메시지 — 다음 요청에서 한번만 읽을 수 있는 데이터
   * 로그인 성공 메시지, 에러 알림 등에 사용
   */
  setFlash(key: string, value: unknown): void {
    this.flash.set(key, value);
    // flash 데이터도 직렬화에 포함
    this.data[`__flash_${key}`] = value;
  }

  /** 내부 직렬화용 */
  toJSON(): SessionData {
    return { ...this.data };
  }

  /** flash 데이터 복원 */
  static fromJSON(data: SessionData): Session {
    const session = new Session();
    const flashKeys: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith("__flash_")) {
        const realKey = key.slice(8);
        session.flash.set(realKey, value);
        flashKeys.push(key);
      } else {
        session.data[key] = value;
      }
    }

    // flash 키는 data에서 제거 (한번 복원되면 끝)
    for (const key of flashKeys) {
      delete session.data[key];
    }

    return session;
  }
}

// ========== Cookie Session Storage ==========

/**
 * 쿠키 기반 세션 스토리지 생성
 *
 * @example
 * ```typescript
 * import { createCookieSessionStorage } from "@mandujs/core";
 *
 * const sessionStorage = createCookieSessionStorage({
 *   cookie: {
 *     name: "__session",
 *     secrets: [process.env.SESSION_SECRET!],
 *     httpOnly: true,
 *     secure: true,
 *     sameSite: "lax",
 *     maxAge: 60 * 60 * 24, // 1일
 *   },
 * });
 *
 * // filling에서 사용
 * .action("login", async (ctx) => {
 *   const session = await sessionStorage.getSession(ctx.cookies);
 *   session.set("userId", user.id);
 *   session.setFlash("message", "로그인 성공!");
 *   const setCookie = await sessionStorage.commitSession(session);
 *   return ctx.redirect("/dashboard", {
 *     headers: { "Set-Cookie": setCookie },
 *   });
 * });
 * ```
 */
export function createCookieSessionStorage(options: CookieSessionOptions): SessionStorage {
  const {
    name = "__session",
    secrets,
    httpOnly = true,
    secure = process.env.NODE_ENV === "production",
    sameSite = "lax",
    maxAge = 86400,
    path = "/",
    domain,
  } = options.cookie;

  if (!secrets.length) {
    throw new Error("[Mandu Session] At least one secret is required");
  }

  const cookieOptions: CookieOptions = {
    httpOnly,
    secure,
    sameSite,
    maxAge,
    path,
    domain,
  };

  return {
    async getSession(cookies: CookieManager): Promise<Session> {
      // Secret rotation: 모든 시크릿으로 검증 시도 (서명은 항상 secrets[0]으로)
      for (const secret of secrets) {
        const raw = await cookies.getSigned(name, secret);
        if (typeof raw === "string" && raw.length > 0) {
          try {
            const data = JSON.parse(raw) as SessionData;
            return Session.fromJSON(data);
          } catch {
            continue;
          }
        }
      }
      return new Session();
    },

    async commitSession(session: Session): Promise<string> {
      const value = JSON.stringify(session.toJSON());
      // 서명된 쿠키로 직렬화
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secrets[0]),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
      const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/, "");

      const cookieValue = `${value}.${sigBase64}`;
      const parts = [`${name}=${encodeURIComponent(cookieValue)}`];
      if (cookieOptions.path) parts.push(`Path=${cookieOptions.path}`);
      if (cookieOptions.domain) parts.push(`Domain=${cookieOptions.domain}`);
      if (cookieOptions.maxAge) parts.push(`Max-Age=${cookieOptions.maxAge}`);
      if (cookieOptions.httpOnly) parts.push("HttpOnly");
      if (cookieOptions.secure) parts.push("Secure");
      if (cookieOptions.sameSite) parts.push(`SameSite=${cookieOptions.sameSite}`);

      return parts.join("; ");
    },

    async destroySession(_session: Session): Promise<string> {
      return `${name}=; Path=${path}; Max-Age=0; HttpOnly${secure ? "; Secure" : ""}`;
    },
  };
}
