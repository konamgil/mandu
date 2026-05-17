import { afterEach, describe, expect, it } from "bun:test";
import type { RoutesManifest } from "../../spec/schema";
import {
  createRuntimeDevtoolsAdapter,
  shouldRecordRuntimeRequest,
  type RuntimeDevtoolsAdapter,
} from "../devtools-adapter";

const manifest: RoutesManifest = {
  version: 1,
  routes: [],
};

describe("runtime devtools adapter", () => {
  let adapter: RuntimeDevtoolsAdapter | null = null;

  afterEach(() => {
    adapter?.stop();
    adapter = null;
  });

  it("stays disabled outside dev mode", async () => {
    adapter = createRuntimeDevtoolsAdapter({
      isDev: false,
      rootDir: process.cwd(),
      manifest,
      guardConfig: null,
    });

    expect(adapter.kitchen).toBeNull();
    expect(adapter.dashboardPath).toBeNull();
    const response = await adapter.handleRequest(
      new Request("http://localhost:3000/__kitchen"),
      "/__kitchen"
    );
    expect(response).toBeNull();
  });

  it("dispatches Kitchen requests in dev mode", async () => {
    adapter = createRuntimeDevtoolsAdapter({
      isDev: true,
      rootDir: process.cwd(),
      manifest,
      guardConfig: null,
    });

    expect(adapter.kitchen).not.toBeNull();
    expect(adapter.dashboardPath).toBe("/__kitchen");
    await expect(
      adapter.handleRequest(new Request("http://localhost:3000/api/ping"), "/api/ping")
    ).resolves.toBeNull();

    const response = await adapter.handleRequest(
      new Request("http://localhost:3000/__kitchen"),
      "/__kitchen"
    );
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("Mandu Kitchen");
  });

  it("keeps framework-internal request paths out of the Kitchen request log", () => {
    expect(shouldRecordRuntimeRequest("/api/ping")).toBe(true);
    expect(shouldRecordRuntimeRequest("/_mandu/heap")).toBe(true);
    expect(shouldRecordRuntimeRequest("/.mandu/client/runtime.js")).toBe(false);
    expect(shouldRecordRuntimeRequest("/__kitchen/api/events")).toBe(false);
    expect(shouldRecordRuntimeRequest("/__mandu/events/recent")).toBe(false);
  });
});
