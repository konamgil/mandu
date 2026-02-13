import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getCommandMock = vi.fn();

vi.mock("../src/commands/registry", () => ({
  commandRegistry: new Map(),
  getCommand: getCommandMock,
}));

vi.mock("../src/terminal", () => ({
  shouldShowBanner: () => false,
  renderHeroBanner: vi.fn(),
  theme: {
    heading: (s: string) => s,
    muted: (s: string) => s,
    command: (s: string) => s,
    option: (s: string) => s,
  },
}));

describe("CLI main lifecycle", () => {
  const exitSpy = vi.spyOn(process, "exit");

  beforeEach(() => {
    getCommandMock.mockReset();
    exitSpy.mockReset();
    exitSpy.mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not force process.exit(0) after a successful command", async () => {
    getCommandMock.mockReturnValue({
      run: vi.fn().mockResolvedValue(true),
    });

    const { main } = await import("../src/main");
    await expect(main(["dev"]))
      .resolves
      .toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
