import { describe, expect, test } from "bun:test";
import {
  TOOL_MODULES,
  validateBuiltinToolModules,
} from "../src/tools/index.js";

describe("builtin MCP tool module registry", () => {
  test("has no duplicate categories or tool definition names", () => {
    expect(validateBuiltinToolModules()).toEqual([]);
  });

  test("validator reports duplicate categories and tool names", () => {
    const duplicate = [
      {
        ...TOOL_MODULES[0],
        category: "dupe",
        definitions: [
          {
            ...TOOL_MODULES[0].definitions[0],
            name: "same.tool",
          },
        ],
      },
      {
        ...TOOL_MODULES[1],
        category: "dupe",
        definitions: [
          {
            ...TOOL_MODULES[1].definitions[0],
            name: "same.tool",
          },
        ],
      },
    ];

    expect(validateBuiltinToolModules(duplicate)).toEqual([
      "duplicate tool category: dupe",
      "duplicate tool definition: same.tool in dupe and dupe",
    ]);
  });

  test("every module declares at least one tool definition", () => {
    for (const module of TOOL_MODULES) {
      expect(module.definitions.length).toBeGreaterThan(0);
    }
  });
});
