import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { specTools } from "../../src/tools/spec.js";

describe("mandu.route.add", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-route-add-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects route paths that resolve outside app", async () => {
    const tools = specTools(root);

    const result = await tools["mandu.route.add"]({
      path: "../outside",
      kind: "page",
    }) as Record<string, unknown>;

    expect(String(result.error)).toContain("inside app");
    await expect(fs.access(path.join(root, "outside", "page.tsx"))).rejects.toThrow();
  });

  it("does not overwrite an existing route source", async () => {
    await fs.mkdir(path.join(root, "app", "dashboard"), { recursive: true });
    const existing = path.join(root, "app", "dashboard", "page.tsx");
    await fs.writeFile(existing, "export default function Existing() {}\n");

    const tools = specTools(root);
    const result = await tools["mandu.route.add"]({
      path: "dashboard",
      kind: "page",
    }) as Record<string, unknown>;

    expect(String(result.error)).toContain("already exists");
    await expect(Bun.file(existing).text()).resolves.toContain("Existing");
  });
});
