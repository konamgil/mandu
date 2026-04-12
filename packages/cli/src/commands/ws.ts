import { scaffold } from "./scaffold";

export interface WsCommandOptions {
  name?: string;
}

export async function ws(options: WsCommandOptions = {}): Promise<boolean> {
  if (!options.name) {
    console.error("Usage: bunx mandu ws <name>");
    return false;
  }

  return scaffold("ws", options.name);
}
