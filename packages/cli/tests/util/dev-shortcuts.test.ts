import { describe, it, expect, mock } from "bun:test";
import {
  handleDevShortcutInput,
  interpretDevShortcut,
  renderDevReadySummary,
} from "../../src/util/dev-shortcuts";

describe("dev shortcut helpers", () => {
  it("renders the ready summary with route and guard information", () => {
    const summary = renderDevReadySummary({
      url: "http://localhost:3333",
      hmrUrl: "ws://localhost:3334",
      guardLabel: "mandu (watching)",
      pageCount: 12,
      apiCount: 5,
      islandCount: 3,
      readyMs: 420,
    });

    expect(summary).toContain("Mandu Dev Server");
    expect(summary).toContain("ready in 420ms");
    expect(summary).toContain("Endpoints");
    expect(summary).toContain("Local     http://localhost:3333");
    expect(summary).toContain("HMR       ws://localhost:3334");
    expect(summary).toContain("State");
    expect(summary).toContain("Routes    12 pages, 5 API, 3 island bundles");
    expect(summary).toContain("Shortcuts");
    expect(summary).toContain("o open browser");
  });

  it("maps shortcut keys to actions", () => {
    expect(interpretDevShortcut("o")).toBe("open");
    expect(interpretDevShortcut("r")).toBe("restart");
    expect(interpretDevShortcut("c")).toBe("clear");
    expect(interpretDevShortcut("q")).toBe("quit");
    expect(interpretDevShortcut("x")).toBe("ignore");
  });

  it("executes the requested shortcut handler", async () => {
    const openBrowser = mock();
    const restartServer = mock(async () => {});
    const clearScreen = mock();
    const quit = mock();

    await expect(handleDevShortcutInput("o", {
      openBrowser,
      restartServer,
      clearScreen,
      quit,
    })).resolves.toBe("open");

    await expect(handleDevShortcutInput("r", {
      openBrowser,
      restartServer,
      clearScreen,
      quit,
    })).resolves.toBe("restart");

    await expect(handleDevShortcutInput("c", {
      openBrowser,
      restartServer,
      clearScreen,
      quit,
    })).resolves.toBe("clear");

    await expect(handleDevShortcutInput("q", {
      openBrowser,
      restartServer,
      clearScreen,
      quit,
    })).resolves.toBe("quit");

    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(restartServer).toHaveBeenCalledTimes(1);
    expect(clearScreen).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
