export type DevShortcutAction = "open" | "restart" | "clear" | "quit" | "ignore";

export interface DevShortcutContext {
  clearScreen: () => void;
  openBrowser: () => void;
  restartServer: () => void | Promise<void>;
  quit: () => void;
}

export interface DevServerSummary {
  url: string;
  hmrUrl?: string;
  guardLabel: string;
  pageCount: number;
  apiCount: number;
  islandCount: number;
  readyMs: number;
}

export function renderDevReadySummary(summary: DevServerSummary): string {
  const lines = [
    `🥟 Mandu ready in ${summary.readyMs}ms`,
    "",
    `  -> Local:   ${summary.url}`,
    `  -> HMR:     ${summary.hmrUrl ?? "disabled"}`,
    `  -> Guard:   ${summary.guardLabel}`,
    `  -> Routes:  ${summary.pageCount} pages, ${summary.apiCount} API, ${summary.islandCount} island bundles`,
    "",
    "  press o to open, r to restart, c to clear, q to quit",
  ];

  return lines.join("\n");
}

export function interpretDevShortcut(input: string): DevShortcutAction {
  switch (input.toLowerCase()) {
    case "o":
      return "open";
    case "r":
      return "restart";
    case "c":
      return "clear";
    case "q":
      return "quit";
    default:
      return "ignore";
  }
}

export async function handleDevShortcutInput(
  input: string,
  context: DevShortcutContext
): Promise<DevShortcutAction> {
  const action = interpretDevShortcut(input);

  switch (action) {
    case "open":
      context.openBrowser();
      return action;
    case "restart":
      await context.restartServer();
      return action;
    case "clear":
      context.clearScreen();
      return action;
    case "quit":
      context.quit();
      return action;
    case "ignore":
    default:
      return "ignore";
  }
}

export function shouldEnableDevShortcuts(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && process.env.CI !== "true";
}
