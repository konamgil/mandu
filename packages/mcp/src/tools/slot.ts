import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  validateSlotContent,
  correctSlotContent,
  summarizeValidationIssues,
} from "@mandujs/core";
import { getProjectPaths, isInsideProject } from "../utils/project.js";
import path from "path";

export const slotToolDefinitions: Tool[] = [
  {
    name: "mandu_read_slot",
    description:
      "Read the TypeScript source of a route's slot file and validate its structure. " +
      "In Mandu, a 'slot' is the server-side data loader for a route: " +
      "it runs on every request before rendering and returns a typed object " +
      "that is injected into the page component as props (for pages) or as handler context (for API routes). " +
      "The loader receives a ManduContext (ctx) with access to ctx.cookies for reading/setting cookies — " +
      "cookies set in the loader are automatically applied to the SSR Response via Set-Cookie headers. " +
      "Advanced: ctx.cookies.getSigned(name, secret) for HMAC-SHA256 signed cookies, " +
      "ctx.cookies.getParsed(name, zodSchema) for Zod-validated JSON cookies. " +
      "Slot files live at spec/slots/{routeId}.slot.ts and are auto-linked by generateManifest(). " +
      "Returns the raw source, line count, and any structural validation issues.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID whose slot file to read (use mandu_list_routes to find IDs)",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_validate_slot",
    description:
      "Validate TypeScript slot content against Mandu's structural rules — without writing any files. " +
      "A valid slot must export a default function (or use the slot() builder) that accepts a Request " +
      "and returns a plain serializable object (becomes the typed props injected into the page). " +
      "Returns: " +
      "errors (must fix before use), " +
      "warnings (best-practice suggestions), " +
      "autoFixable issues (with corrected code preview), " +
      "manualFixRequired items (issues needing human review). " +
      "Use this before writing a slot file with the Edit tool to catch structural problems early.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The TypeScript slot source code to validate",
        },
      },
      required: ["content"],
    },
  },
];

export function slotTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_read_slot: async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      // Load manifest to find the route
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      const route = manifestResult.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.slotModule) {
        return {
          error: `Route '${routeId}' does not have a slotModule defined`,
          tip: "Add slotModule to the route spec or use mandu_update_route",
        };
      }

      const slotPath = path.join(projectRoot, route.slotModule);

      // Security check
      if (!isInsideProject(slotPath, projectRoot)) {
        return { error: "Slot path is outside project directory" };
      }

      try {
        const file = Bun.file(slotPath);
        if (!(await file.exists())) {
          return {
            exists: false,
            slotPath: route.slotModule,
            message: "Slot file does not exist. Run mandu_generate to create it.",
          };
        }

        const content = await file.text();

        // Validate existing slot content structure
        const validation = validateSlotContent(content);

        return {
          exists: true,
          slotPath: route.slotModule,
          content,
          lineCount: content.split("\n").length,
          validation: {
            valid: validation.valid,
            summary: summarizeValidationIssues(validation.issues),
            issues: validation.issues,
          },
        };
      } catch (error) {
        return {
          error: `Failed to read slot file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    mandu_validate_slot: async (args: Record<string, unknown>) => {
      const { content } = args as { content: string };

      const validation = validateSlotContent(content);

      // Classify issues by whether they can be auto-fixed
      const autoFixable = validation.issues.filter((i) => i.autoFixable);
      const manualFix = validation.issues.filter((i) => !i.autoFixable);

      // Generate correction preview for auto-fixable issues
      let correctionPreview = null;
      if (autoFixable.length > 0) {
        const correction = correctSlotContent(content, validation.issues);
        correctionPreview = {
          wouldFix: correction.appliedFixes.length,
          fixes: correction.appliedFixes,
          resultingContent:
            correction.corrected
              ? `(${correction.content.split("\n").length} lines after correction)`
              : null,
        };
      }

      return {
        valid: validation.valid,
        summary: summarizeValidationIssues(validation.issues),
        errors: validation.issues.filter((i) => i.severity === "error"),
        warnings: validation.issues.filter((i) => i.severity === "warning"),
        autoFixable: autoFixable.map((i) => ({
          code: i.code,
          message: i.message,
          line: i.line,
        })),
        manualFixRequired: manualFix.map((i) => ({
          code: i.code,
          message: i.message,
          suggestion: i.suggestion,
          line: i.line,
        })),
        correctionPreview,
        tip: validation.valid
          ? "Content is valid. Use Edit tool to write the slot file."
          : autoFixable.length > 0
            ? "Auto-fixable issues found. Apply corrections and use Edit tool to write."
            : "Manual fixes required before writing. Use Edit tool after fixing.",
      };
    },
  };
}
