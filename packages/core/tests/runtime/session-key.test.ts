/**
 * DNA-004: Session Key Tests
 */

import { describe, it, expect } from "bun:test";
import {
  buildSessionKey,
  buildCacheKey,
  buildChannelKey,
  parseSessionKey,
  matchKeyPattern,
} from "../../src/runtime/session-key";

describe("DNA-004: Session Key Utilities", () => {
  describe("buildSessionKey", () => {
    it("should build global session key", () => {
      const key = buildSessionKey({ route: "/dashboard", scope: "global" });
      expect(key).toBe("session:dashboard");
    });

    it("should build team session key", () => {
      const key = buildSessionKey({
        route: "/projects",
        scope: "team",
        teamId: "team-123",
      });
      expect(key).toBe("session:projects:team:team-123");
    });

    it("should build user session key", () => {
      const key = buildSessionKey({
        route: "/profile",
        scope: "user",
        userId: "user-456",
      });
      expect(key).toBe("session:profile:user:user-456");
    });

    it("should build session key with params", () => {
      const key = buildSessionKey({
        route: "/search",
        scope: "global",
        params: { q: "mandu", page: "1" },
      });
      expect(key).toBe("session:search:page=1&q=mandu");
    });

    it("should build request-scoped key with unique suffix", () => {
      const key1 = buildSessionKey({ route: "/api/data", scope: "request" });
      const key2 = buildSessionKey({ route: "/api/data", scope: "request" });

      expect(key1).toMatch(/^session:api-data:req:\d+-[a-z0-9]+$/);
      expect(key1).not.toBe(key2); // 고유해야 함
    });

    it("should use custom namespace", () => {
      const key = buildSessionKey({
        route: "/dashboard",
        scope: "global",
        namespace: "state",
      });
      expect(key).toBe("state:dashboard");
    });

    it("should normalize special characters", () => {
      const key = buildSessionKey({
        route: "/api/users/123",
        scope: "global",
      });
      expect(key).toBe("session:api-users-123");
    });

    it("should fallback to team when user scope has no userId", () => {
      const key = buildSessionKey({
        route: "/data",
        scope: "user",
        teamId: "team-789",
      });
      expect(key).toBe("session:data:team:team-789");
    });
  });

  describe("buildCacheKey", () => {
    it("should build basic cache key", () => {
      const key = buildCacheKey({ type: "ssr", resource: "/blog/123" });
      expect(key).toBe("cache:ssr:blog-123");
    });

    it("should build cache key with version", () => {
      const key = buildCacheKey({
        type: "api",
        resource: "users",
        version: "v2",
      });
      expect(key).toBe("cache:api:users:v2");
    });

    it("should build cache key with params", () => {
      const key = buildCacheKey({
        type: "data",
        resource: "products",
        params: { category: "food", limit: 10 },
      });
      expect(key).toBe("cache:data:products:category=food&limit=10");
    });

    it("should build user-specific cache key", () => {
      const key = buildCacheKey({
        type: "ssr",
        resource: "/dashboard",
        userId: "user-123",
      });
      expect(key).toBe("cache:ssr:dashboard:user:user-123");
    });

    it("should sort params alphabetically", () => {
      const key = buildCacheKey({
        type: "data",
        resource: "items",
        params: { z: "last", a: "first", m: "middle" },
      });
      expect(key).toBe("cache:data:items:a=first&m=middle&z=last");
    });
  });

  describe("buildChannelKey", () => {
    it("should build user channel key", () => {
      const key = buildChannelKey({
        channel: "notifications",
        userId: "user-123",
      });
      expect(key).toBe("ws:notifications:user:user-123");
    });

    it("should build team channel key", () => {
      const key = buildChannelKey({
        channel: "team-chat",
        teamId: "team-456",
      });
      expect(key).toBe("ws:team-chat:team:team-456");
    });

    it("should prefer userId over teamId", () => {
      const key = buildChannelKey({
        channel: "mixed",
        userId: "user-123",
        teamId: "team-456",
      });
      expect(key).toBe("ws:mixed:user:user-123");
    });

    it("should build channel without scope", () => {
      const key = buildChannelKey({ channel: "broadcast" });
      expect(key).toBe("ws:broadcast");
    });
  });

  describe("parseSessionKey", () => {
    it("should parse global session key", () => {
      const result = parseSessionKey("session:dashboard");
      expect(result).toEqual({
        namespace: "session",
        route: "dashboard",
        scope: "global",
        teamId: undefined,
        userId: undefined,
        params: undefined,
      });
    });

    it("should parse team session key", () => {
      const result = parseSessionKey("session:projects:team:team-123");
      expect(result).toEqual({
        namespace: "session",
        route: "projects",
        scope: "team",
        teamId: "team-123",
        userId: undefined,
        params: undefined,
      });
    });

    it("should parse user session key", () => {
      const result = parseSessionKey("session:profile:user:user-456");
      expect(result).toEqual({
        namespace: "session",
        route: "profile",
        scope: "user",
        teamId: undefined,
        userId: "user-456",
        params: undefined,
      });
    });

    it("should parse key with params", () => {
      const result = parseSessionKey("session:search:page=1&q=mandu");
      expect(result?.params).toBe("page=1&q=mandu");
    });

    it("should return null for invalid key", () => {
      expect(parseSessionKey("invalid")).toBeNull();
      expect(parseSessionKey("")).toBeNull();
    });
  });

  describe("matchKeyPattern", () => {
    it("should match exact keys", () => {
      expect(matchKeyPattern("session:dashboard", "session:dashboard")).toBe(true);
      expect(matchKeyPattern("session:dashboard", "session:profile")).toBe(false);
    });

    it("should match with single wildcard", () => {
      expect(
        matchKeyPattern("session:dashboard:*", "session:dashboard:team:team-123")
      ).toBe(true);
      expect(
        matchKeyPattern("session:dashboard:*", "session:profile:team:team-123")
      ).toBe(false);
    });

    it("should match with double wildcard", () => {
      expect(matchKeyPattern("cache:**:user:user-123", "cache:ssr:data:user:user-123")).toBe(
        true
      );
    });

    it("should not match shorter keys without wildcard", () => {
      expect(matchKeyPattern("session:dashboard:team", "session:dashboard")).toBe(
        false
      );
    });

    it("should match prefix patterns", () => {
      expect(matchKeyPattern("cache:ssr:*", "cache:ssr:page-1")).toBe(true);
      expect(matchKeyPattern("cache:ssr:*", "cache:api:users")).toBe(false);
    });
  });
});
