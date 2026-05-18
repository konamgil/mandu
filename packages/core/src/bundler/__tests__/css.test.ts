import { describe, expect, test } from "bun:test";
import { __private } from "../css";

describe("CSS Tailwind command resolution", () => {
  test("uses process.execPath when it is Bun", () => {
    expect(
      __private.getTailwindCommand(["@tailwindcss/cli"], "C:\\tools\\bun.exe"),
    ).toEqual(["C:\\tools\\bun.exe", "x", "@tailwindcss/cli"]);
  });

  test("does not treat standalone mandu.exe as Bun", () => {
    expect(
      __private.getTailwindCommand(
        ["@tailwindcss/cli"],
        "C:\\Users\\User\\AppData\\Local\\Mandu\\bin\\mandu.exe",
        () => "C:\\Users\\User\\.bun\\bin\\bun.exe",
      ),
    ).toEqual(["C:\\Users\\User\\.bun\\bin\\bun.exe", "x", "@tailwindcss/cli"]);
  });
});
