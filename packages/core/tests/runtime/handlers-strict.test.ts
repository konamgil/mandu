import { describe, expect, spyOn, test } from "bun:test";
import { registerManifestHandlers } from "../../src/runtime/handlers";
import type { RoutesManifest } from "../../src/spec/schema";

const apiManifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "api-broken",
      pattern: "/api/broken",
      kind: "api",
      module: "app/api/broken/route.ts",
    },
  ],
};

describe("registerManifestHandlers strict mode", () => {
  test("production registration rejects an API module import failure", async () => {
    await expect(
      registerManifestHandlers(apiManifest, process.cwd(), {
        importFn: async () => {
          throw new Error("synthetic import failure");
        },
        registeredLayouts: new Set(),
        strict: true,
      }),
    ).rejects.toThrow(/Failed to load API handler: api-broken/);
  });

  test("dev registration remains tolerant for overlay recovery", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        registerManifestHandlers(apiManifest, process.cwd(), {
          importFn: async () => {
            throw new Error("synthetic import failure");
          },
          registeredLayouts: new Set(),
        }),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
