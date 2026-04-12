/**
 * MCP Prompts for Mandu Framework
 *
 * Conversation templates that guide agents through common Mandu workflows.
 */

import type { Prompt, GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

export const manduPrompts: Prompt[] = [
  {
    name: "new-feature",
    description: "Guide creating a new feature with routes, contracts, and islands",
    arguments: [
      { name: "description", description: "Feature description", required: true },
    ],
  },
  {
    name: "debug",
    description: "Diagnose and fix errors in the Mandu project",
    arguments: [
      { name: "symptom", description: "Error message or symptom", required: false },
    ],
  },
  {
    name: "add-crud",
    description: "Create a complete CRUD API with contracts and tests",
    arguments: [
      { name: "resource", description: "Resource name (e.g., 'products')", required: true },
    ],
  },
];

function msg(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type PromptHandler = (args: Record<string, string>) => GetPromptResult;

const promptHandlers: Record<string, PromptHandler> = {
  "new-feature": (args) => msg(`Create a new feature: ${args.description}

Follow these steps using Mandu MCP tools:

1. Read current route manifest: Resource mandu://routes
2. Read project config: Resource mandu://config
3. Negotiate the feature spec: Tool mandu.negotiate
4. Generate scaffold: Tool mandu.negotiate.scaffold
5. If client interactivity needed, create island: Tool mandu_create_island
   Use the declarative pattern: island('visible', Component)
6. If data requirements exist, create slot: Tool mandu_create_slot
   Slots are server-side data loaders that run before render
7. If API is exposed, define contract: Tool mandu_create_contract
   Contracts are Zod schemas for validation and OpenAPI generation
8. Validate architecture: Tool mandu_guard_check
9. Run brain doctor: Tool mandu_brain_diagnose`),

  "debug": (args) => msg(`${args.symptom ? `Diagnose this error: ${args.symptom}` : "Diagnose errors in the Mandu project"}

Follow these diagnostic steps using Mandu MCP tools:

1. Check client-side errors: Tool mandu.kitchen.errors
2. Check recent build/runtime errors: Resource mandu://errors
3. Check architecture rule violations: Resource mandu://watch/warnings
4. Run brain doctor for structural analysis: Tool mandu_brain_diagnose
5. Verify route manifest: Resource mandu://routes
6. Inspect specific route slot: Resource mandu://slots/{routeId}
7. Run guard check: Tool mandu_guard_check

After identifying root cause, fix and re-run checks to confirm.`),

  "add-crud": (args) => {
    const r = args.resource;
    const R = capitalize(r);
    return msg(`Create a complete CRUD API for the '${r}' resource.

Follow these steps using Mandu MCP tools:

1. Read project config: Resource mandu://config
2. Create API routes: Tool mandu.negotiate
   - GET/POST for /api/${r}, GET/PUT/DELETE for /api/${r}/[id]
3. Define contracts: Tool mandu_create_contract
   - Create${R}Schema, Update${R}Schema, ${R}ResponseSchema
4. Generate scaffold: Tool mandu.negotiate.scaffold
5. Create data slot for list page: Tool mandu_create_slot
6. Validate: Tool mandu_guard_check + Tool mandu_brain_diagnose
7. Verify routes: Resource mandu://routes`);
  },
};

/**
 * Get the prompt handler result for a given prompt name and arguments.
 */
export function getPromptResult(
  name: string,
  args: Record<string, string>,
): GetPromptResult | null {
  const handler = promptHandlers[name];
  if (!handler) return null;
  return handler(args);
}
