/**
 * mandu scaffold - Unified boilerplate generator
 *
 * Usage:
 *   mandu scaffold middleware          Generate middleware.ts
 *   mandu scaffold ws <name>           Generate WebSocket route
 *   mandu scaffold session             Generate session storage helper
 */

import path from "path";
import fs from "fs/promises";
import { MIDDLEWARE_TEMPLATE, wsTemplate, SESSION_TEMPLATE } from "./scaffold-templates";

export async function scaffold(type: string, name: string): Promise<boolean> {
  const cwd = process.cwd();

  switch (type) {
    case "middleware":
      return generate(path.join(cwd, "middleware.ts"), MIDDLEWARE_TEMPLATE, "middleware.ts", [
        "Import and configure in your server entry if needed.",
        "Runs before every request when registered.",
      ]);
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
    default:
      console.error(`Unknown scaffold type: ${type}`);
      console.error("Available: middleware, ws, session");
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
