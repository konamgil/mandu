/**
 * mandu scaffold - Unified boilerplate generator
 *
 * Usage:
 *   mandu scaffold middleware          Generate middleware.ts
 *   mandu scaffold ws <name>           Generate WebSocket route
 *   mandu scaffold session             Generate session storage helper
 *   mandu scaffold auth                Generate auth helpers and routes
 *   mandu scaffold collection <name>   Generate content collection scaffold
 */

import path from "path";
import fs from "fs/promises";
import {
  getMiddlewareTemplate,
  normalizeMiddlewarePreset,
  wsTemplate,
  SESSION_TEMPLATE,
} from "./scaffold-templates";

export interface ScaffoldOptions {
  preset?: string;
  schema?: string;
}

export async function scaffold(type: string, name: string, options: ScaffoldOptions = {}): Promise<boolean> {
  const cwd = process.cwd();

  switch (type) {
    case "middleware": {
      const template = getMiddlewareTemplate(options.preset);
      if (!template) {
        console.error(`Unknown middleware preset: ${options.preset}`);
        console.error("Available presets: default, jwt, all");
        return false;
      }
      const preset = normalizeMiddlewarePreset(options.preset) ?? "default";
      return generate(path.join(cwd, "middleware.ts"), template, "middleware.ts", [
        "Import and configure in your server entry if needed.",
        "Runs before every request when registered.",
        preset === "default"
          ? "Edit the default checks to match your route protection rules."
          : `Preset applied: ${preset}`,
      ]);
    }
    case "ws":
      if (!name) {
        console.error("Usage: mandu scaffold ws <name>");
        return false;
      }
      return generate(
        path.join(cwd, "app", "api", name, "route.ts"),
        wsTemplate(name),
        `app/api/${name}/route.ts`,
        [`Connect at ws://localhost:3333/api/${name}`, "Upgrade logic is handled by the server runtime."],
      );
    case "session":
      return generate(
        path.join(cwd, "src", "server", "session.ts"),
        SESSION_TEMPLATE,
        "src/server/session.ts",
        ["Import { getSession } from 'src/server/session' in your route handlers.",
         "Configure SESSION_SECRET via environment variable before production."],
      );
    case "auth": {
      const { authInit } = await import("./auth");
      return authInit({ strategy: "jwt" });
    }
    case "collection": {
      const { collectionCreate } = await import("./collection");
      return collectionCreate({
        name,
        schema: options.schema ?? options.preset,
      });
    }
    default:
      console.error(`Unknown scaffold type: ${type}`);
      console.error("Available: middleware, ws, session, auth, collection");
      return false;
  }
}

async function generate(
  filePath: string,
  content: string,
  displayPath: string,
  nextSteps: string[],
): Promise<boolean> {
  try {
    await fs.access(filePath);
    console.error(`File already exists: ${displayPath}`);
    return false;
  } catch {
    // does not exist — proceed
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);

  console.log(`Created ${displayPath}`);
  console.log("\nNext steps:");
  for (const step of nextSteps) {
    console.log(`  - ${step}`);
  }
  return true;
}
