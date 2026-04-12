import { scaffold } from "./scaffold";

export interface MiddlewareInitOptions {
  preset?: string;
}

export async function middlewareInit(options: MiddlewareInitOptions = {}): Promise<boolean> {
  return scaffold("middleware", "", { preset: options.preset });
}
