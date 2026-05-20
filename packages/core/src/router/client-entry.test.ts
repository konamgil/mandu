import { describe, expect, it } from "bun:test";
import { findClientComponentImports } from "./client-entry";

describe("findClientComponentImports", () => {
  it("detects named .client imports for diagnostics", () => {
    const imports = findClientComponentImports(`
      import { LoginForm, SubmitButton as Button } from "@/client/widgets/login-form/LoginForm.client";
      import Header from "./Header.client.tsx";
    `);

    expect(imports).toEqual([
      {
        module: "@/client/widgets/login-form/LoginForm.client",
        kind: "named",
        names: ["LoginForm", "SubmitButton"],
      },
      {
        module: "./Header.client.tsx",
        kind: "default",
        names: ["Header"],
      },
    ]);
  });
});
