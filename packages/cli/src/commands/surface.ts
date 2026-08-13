/**
 * Product-facing CLI surface.
 *
 * The registry intentionally keeps compatibility commands during the v0 to
 * v1 migration. This manifest is the product contract: only `official`
 * commands appear in global help; every other command has an explicit owner
 * and migration path.
 */
export type CommandSurface =
  | "official"
  | "compatibility"
  | "labs"
  | "internal"
  | "retired";

export const OFFICIAL_COMMANDS = [
  "create",
  "dev",
  "build",
  "start",
  "check",
  "agent",
] as const;

export const COMMAND_SURFACE: Readonly<Record<string, CommandSurface>> = {
  create: "official",
  dev: "official",
  build: "official",
  start: "official",
  check: "official",
  agent: "official",

  init: "compatibility",
  info: "compatibility",
  preview: "compatibility",
  diagnose: "compatibility",
  guard: "compatibility",
  routes: "compatibility",
  contract: "compatibility",
  openapi: "compatibility",
  change: "compatibility",
  lint: "compatibility",
  doctor: "compatibility",
  lock: "compatibility",
  test: "compatibility",
  generate: "compatibility",
  fix: "compatibility",
  review: "compatibility",
  ask: "compatibility",
  explain: "compatibility",
  scaffold: "compatibility",
  new: "compatibility",
  mcp: "compatibility",
  "skills:generate": "compatibility",
  "skills:list": "compatibility",

  design: "labs",
  brain: "labs",
  watch: "labs",
  monitor: "labs",
  add: "labs",
  ate: "labs",
  "test:auto": "labs",
  "test:watch": "labs",
  "test:heal": "labs",
  middleware: "labs",
  session: "labs",
  auth: "labs",
  ws: "labs",
  collection: "labs",
  db: "labs",
  desktop: "labs",
  ai: "labs",

  clean: "internal",
  cache: "internal",
  upgrade: "internal",
  completion: "internal",

  deploy: "retired",
  "deploy:plan": "retired",
};

export const COMMAND_REPLACEMENTS: Readonly<Record<string, string>> = {
  init: "mandu create <name>",
  info: "mandu agent context",
  preview: "mandu build && mandu start",
  diagnose: "mandu agent verify",
  guard: "mandu check",
  routes: "mandu agent apply",
  contract: "mandu agent apply",
  openapi: "mandu build",
  change: "mandu agent apply",
  lint: "mandu check",
  doctor: "mandu agent repair",
  lock: "mandu agent verify",
  test: "mandu check",
  generate: "mandu agent apply",
  fix: "mandu agent repair",
  review: "mandu agent verify",
  ask: "mandu agent plan",
  explain: "mandu agent verify",
  scaffold: "mandu agent apply",
  new: "mandu agent apply",
  mcp: "bunx mandu-mcp or mandu agent sync",
  "skills:generate": "mandu agent sync",
  "skills:list": "mandu agent context",
  deploy: "mandu build, then use your provider CLI",
  "deploy:plan": "deployment provider configuration outside Mandu",
};

export function getCommandSurface(command: string): CommandSurface | null {
  return COMMAND_SURFACE[command] ?? null;
}

export function getCommandReplacement(command: string): string | null {
  return COMMAND_REPLACEMENTS[command] ?? null;
}
