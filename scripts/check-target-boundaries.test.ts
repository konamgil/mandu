import { describe, expect, test } from "bun:test";
import {
  scanImportReferences,
  type BoundaryPolicy,
  type ImportReference,
} from "./check-target-boundaries";

function checkRefs(policy: BoundaryPolicy, refs: ImportReference[]) {
  return refs
    .map((ref) => policy.forbidden(ref.specifier, ref.kind))
    .filter((reason): reason is string => reason !== null);
}

describe("scanImportReferences", () => {
  test("finds static, dynamic, and require references", () => {
    const refs = scanImportReferences(`
      import fs from "node:fs";
      export { x } from "webview-bun";
      const mod = await import("axe-core");
      const path = require("node:path");
    `);

    expect(refs.map((ref) => [ref.kind, ref.specifier])).toEqual([
      ["static", "node:fs"],
      ["static", "webview-bun"],
      ["dynamic", "axe-core"],
      ["require", "node:path"],
    ]);
  });

  test("ignores imports inside comments and template strings", () => {
    const refs = scanImportReferences(`
      // import x from "axe-core";
      /*
       * export { y } from "jsdom";
       */
      const generated = \`
        import * as Runtime from "react-refresh/runtime";
      \`;
      import { ok } from "./real";
    `);

    expect(refs.map((ref) => ref.specifier)).toEqual(["./real"]);
  });
});

describe("target boundary policies", () => {
  const optionalPeerPolicy: BoundaryPolicy = {
    name: "optional peers stay lazy",
    roots: [],
    forbidden(specifier, kind) {
      if (kind === "dynamic") return null;
      return specifier === "axe-core"
        ? "optional peer dependencies must be loaded lazily"
        : null;
    },
  };

  test("allows dynamic optional peer loading but rejects static loading", () => {
    const refs = scanImportReferences(`
      import axe from "axe-core";
      const lazy = await import("axe-core");
    `);

    expect(checkRefs(optionalPeerPolicy, refs)).toEqual([
      "optional peer dependencies must be loaded lazily",
    ]);
  });

  test("can allow documented lazy edge runtime probes", () => {
    const edgePolicy: BoundaryPolicy = {
      name: "edge source stays runtime-neutral",
      roots: [],
      forbidden(specifier, kind) {
        if (kind === "dynamic" && specifier === "node:async_hooks") return null;
        if (specifier.startsWith("node:")) return "edge source must not import Node builtins";
        return null;
      },
    };

    const refs = scanImportReferences(`
      const als = await import("node:async_hooks");
      import fs from "node:fs";
    `);

    expect(checkRefs(edgePolicy, refs)).toEqual([
      "edge source must not import Node builtins",
    ]);
  });
});
