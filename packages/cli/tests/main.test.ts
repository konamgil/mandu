import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from "bun:test";

const getCommandMock = mock(() => {});
const getAllCommandRegistrationsMock = mock(() => []);

mock.module("../src/commands/registry", () => ({
  commandRegistry: new Map(),
  getCommand: getCommandMock,
  getAllCommandRegistrations: getAllCommandRegistrationsMock,
}));

process.env.MANDU_NO_BANNER = "1";

describe("CLI main lifecycle", () => {
  const exitSpy = spyOn(process, "exit");

  afterAll(() => {
    delete process.env.MANDU_NO_BANNER;
  });

  beforeEach(() => {
    getCommandMock.mockReset();
    exitSpy.mockReset();
    exitSpy.mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  it("does not force process.exit(0) after a successful command", async () => {
    getCommandMock.mockReturnValue({
      run: mock(async () => true),
    });

    const { main } = await import("../src/main");
    await expect(main(["dev"]))
      .resolves
      .toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits after a successful one-shot command when requested", async () => {
    getCommandMock.mockReturnValue({
      exitOnSuccess: true,
      run: mock(async () => true),
    });

    const { main } = await import("../src/main");
    await expect(main(["build"]))
      .rejects
      .toThrow("process.exit:0");

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("parses --key=value style flags", async () => {
    const { parseArgs } = await import("../src/main");
    expect(parseArgs(["auth", "init", "--strategy=jwt"])).toEqual({
      command: "auth",
      options: {
        _positional: "init",
        strategy: "jwt",
      },
    });
  });
});
