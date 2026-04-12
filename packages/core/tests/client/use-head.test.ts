/**
 * Tests for packages/core/src/client/use-head.ts (SSR collection functions only)
 * React hooks (useHead/useSeoMeta) are NOT tested here — SSR pure functions만 검증
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { resetSSRHead, getSSRHeadTags } from "../../src/client/use-head";

describe("SSR Head Collection", () => {
  beforeEach(() => {
    resetSSRHead();
  });

  it("resetSSRHead clears collected tags", () => {
    expect(getSSRHeadTags()).toBe("");
  });

  it("getSSRHeadTags returns empty string when no tags collected", () => {
    resetSSRHead();
    expect(getSSRHeadTags()).toBe("");
  });
});

describe("Module exports", () => {
  it("exports resetSSRHead as function", () => {
    expect(typeof resetSSRHead).toBe("function");
  });

  it("exports getSSRHeadTags as function", () => {
    expect(typeof getSSRHeadTags).toBe("function");
  });

  it("exports useHead as function", async () => {
    const mod = await import("../../src/client/use-head");
    expect(typeof mod.useHead).toBe("function");
  });

  it("exports useSeoMeta as function", async () => {
    const mod = await import("../../src/client/use-head");
    expect(typeof mod.useSeoMeta).toBe("function");
  });
});
