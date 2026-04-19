/**
 * Regression: issue #190
 *
 * `resolveDisplayHost()` maps server bind addresses to URLs that are safe
 * to hand to a browser. Wildcard (`0.0.0.0`, `::`) must become `localhost`
 * because browsers refuse to navigate to wildcard literals.
 */
import { describe, it, expect } from "bun:test";
import { resolveDisplayHost } from "../host";

describe("resolveDisplayHost (#190)", () => {
  it("maps 0.0.0.0 → localhost", () => {
    expect(resolveDisplayHost("0.0.0.0")).toBe("localhost");
  });

  it("maps :: → localhost", () => {
    expect(resolveDisplayHost("::")).toBe("localhost");
  });

  it("maps [::] → localhost", () => {
    expect(resolveDisplayHost("[::]")).toBe("localhost");
  });

  it("maps undefined → localhost", () => {
    expect(resolveDisplayHost(undefined)).toBe("localhost");
  });

  it("maps empty string → localhost", () => {
    expect(resolveDisplayHost("")).toBe("localhost");
  });

  it("preserves IPv4 host", () => {
    expect(resolveDisplayHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("preserves DNS hostname", () => {
    expect(resolveDisplayHost("example.com")).toBe("example.com");
  });

  it("brackets bare IPv6 literal", () => {
    expect(resolveDisplayHost("::1")).toBe("[::1]");
  });

  it("leaves already-bracketed IPv6 unchanged", () => {
    expect(resolveDisplayHost("[::1]")).toBe("[::1]");
  });

  it("brackets longer IPv6", () => {
    expect(resolveDisplayHost("fe80::1")).toBe("[fe80::1]");
  });
});
