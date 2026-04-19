/**
 * `deno.json` generator for Deno Deploy.
 *
 * Emits a minimal Deno configuration covering:
 *   - Tasks (`deno task dev`, `deno task deploy`)
 *   - `compilerOptions` with React JSX defaults (matches Mandu's host TS
 *     config)
 *   - Optional import map for `npm:` prefixes so user code can reach
 *     `@mandujs/core` and `@mandujs/edge` through the same specifiers
 *     as it does in Bun/Node.
 *   - `deploy` block with Deno Deploy entrypoint + project name.
 *
 * The caller is responsible for writing the output to disk. The function
 * returns a JSON string so the Deno tooling and humans can read it
 * directly without an extra parse step.
 */

export interface DenoConfigOptions {
  /** Deno Deploy project name (required). */
  projectName: string;
  /**
   * Relative path to the generated server entry. Defaults to
   * `.mandu/deno/server.ts`.
   */
  entry?: string;
  /**
   * Deno `lib` values. Defaults to the browser-compatible + Deno std
   * surface we need for SSR.
   */
  lib?: string[];
  /** Map of npm: / jsr: aliases. Merged with Mandu's defaults. */
  imports?: Record<string, string>;
  /**
   * Deno Deploy cron triggers. Example: `{ name: "cleanup", schedule: "@daily" }`.
   * Written under `deploy.cron` — Deno Deploy reads this at deploy time.
   */
  crons?: Array<{ name: string; schedule: string }>;
  /**
   * Exclude patterns for the Deno Deploy uploader. Defaults to sane ignores
   * (`node_modules`, `.mandu/workers`, etc.).
   */
  exclude?: string[];
}

const DEFAULT_LIB = ["deno.window", "esnext", "dom", "dom.iterable"];
const DEFAULT_EXCLUDE = [
  "node_modules/",
  ".mandu/workers/",
  ".mandu/vercel/",
  ".mandu/netlify/",
];

/**
 * Generate the `deno.json` contents as a JSON string.
 *
 * @example
 * ```ts
 * const json = generateDenoConfig({ projectName: "my-mandu-app" });
 * await Bun.write("./deno.json", json);
 * ```
 */
export function generateDenoConfig(options: DenoConfigOptions): string {
  if (!options.projectName || typeof options.projectName !== "string") {
    throw new Error("generateDenoConfig: projectName is required");
  }
  if (!/^[a-z0-9-]+$/.test(options.projectName)) {
    throw new Error(
      `generateDenoConfig: projectName must match /^[a-z0-9-]+$/ ` +
        `(got: "${options.projectName}")`
    );
  }

  const entry = options.entry ?? ".mandu/deno/server.ts";
  const lib = options.lib ?? DEFAULT_LIB;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;

  // Base import map — keep minimal and merge user overrides on top. We do
  // NOT pin a specific `@mandujs/core` version here; Deno resolves the
  // `npm:` specifier against the registry at deploy time.
  const defaultImports: Record<string, string> = {
    "@mandujs/core": "npm:@mandujs/core",
    "@mandujs/core/": "npm:@mandujs/core/",
    "@mandujs/edge": "npm:@mandujs/edge",
    "@mandujs/edge/": "npm:@mandujs/edge/",
    react: "npm:react@19",
    "react-dom": "npm:react-dom@19",
    "react-dom/": "npm:react-dom@19/",
  };
  const imports = { ...defaultImports, ...(options.imports ?? {}) };

  const config: Record<string, unknown> = {
    // Leading comment not possible in JSON — we keep the marker as a key
    // Deno ignores unless it consumes the leading $schema hint.
    $schema: "https://deno.land/x/deno/cli/schemas/config-file.v1.json",
    tasks: {
      dev: `deno run --allow-net --allow-env --allow-read ${entry}`,
      start: `deno run --allow-net --allow-env --allow-read ${entry}`,
      deploy: `deployctl deploy --project=${options.projectName} ${entry}`,
    },
    compilerOptions: {
      jsx: "react-jsx",
      jsxImportSource: "react",
      lib,
      strict: true,
    },
    imports,
    exclude,
    deploy: {
      project: options.projectName,
      entrypoint: entry,
      exclude,
    } as Record<string, unknown>,
  };

  if (options.crons && options.crons.length > 0) {
    for (const cron of options.crons) {
      if (!cron.name || !cron.schedule) {
        throw new Error(
          "generateDenoConfig: each cron entry requires both 'name' and 'schedule'"
        );
      }
    }
    (config.deploy as Record<string, unknown>).cron = options.crons;
  }

  return JSON.stringify(config, null, 2) + "\n";
}
