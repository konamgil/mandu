import {
  compose as composeMiddleware,
  type ComposedHandler,
  type FinalHandler,
} from "../middleware/compose";
import type { Middleware } from "../middleware/define";

export type { ComposedHandler, FinalHandler };

export function buildRequestMiddlewareChain(
  middleware: Middleware[] | undefined
): ComposedHandler | undefined {
  return middleware && middleware.length > 0
    ? composeMiddleware(...middleware)
    : undefined;
}

export interface RunRequestMiddlewareOptions {
  req: Request;
  middlewareChain: ComposedHandler | undefined;
  finalHandler: FinalHandler;
  skipMiddleware?: boolean;
}

export async function runRequestMiddleware(
  options: RunRequestMiddlewareOptions
): Promise<Response | undefined> {
  const { req, middlewareChain, finalHandler, skipMiddleware = false } = options;
  if (skipMiddleware || !middlewareChain) return undefined;
  return middlewareChain(req, finalHandler);
}
