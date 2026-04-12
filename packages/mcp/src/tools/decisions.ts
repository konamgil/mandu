import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  searchDecisions,
  saveDecision,
  checkConsistency,
  getCompactArchitecture,
  getNextDecisionId,
  type ArchitectureDecision,
  type DecisionStatus,
} from "@mandujs/core";

export const decisionToolDefinitions: Tool[] = [
  {
    name: "mandu.decision.list",
    description:
      "Search architecture decisions (ADRs) by tags. Use before implementing features for consistency.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to search for (e.g., ['auth', 'cache', 'api'])",
        },
      },
      required: ["tags"],
    },
  },
  {
    name: "mandu.decision.save",
    description:
      "Save a new architecture decision record (ADR) for future consistency checks.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Decision title (e.g., 'Use JWT for API Authentication')",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for searchability (e.g., ['auth', 'api', 'security'])",
        },
        context: {
          type: "string",
          description: "Why this decision was needed",
        },
        decision: {
          type: "string",
          description: "What was decided",
        },
        consequences: {
          type: "array",
          items: { type: "string" },
          description: "Impact and trade-offs of this decision",
        },
        status: {
          type: "string",
          enum: ["proposed", "accepted", "deprecated", "superseded"],
          description: "Decision status (default: proposed)",
        },
      },
      required: ["title", "tags", "context", "decision", "consequences"],
    },
  },
  {
    name: "mandu.decision.check",
    description:
      "Check if a proposed change conflicts with existing architecture decisions.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "What you're trying to do (e.g., 'Add Redis caching layer')",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Related tags to check against (e.g., ['cache', 'redis'])",
        },
      },
      required: ["intent", "tags"],
    },
  },
  {
    name: "mandu.decision.architecture",
    description:
      "Get a compact summary of project architecture decisions and rules.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function decisionTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.decision.list": async (args: Record<string, unknown>) => {
      const { tags } = args as { tags: string[] };

      if (!tags || tags.length === 0) {
        return {
          error: "Tags are required",
          tip: "Provide at least one tag to search for (e.g., ['auth', 'cache'])",
        };
      }

      const result = await searchDecisions(projectRoot, tags);

      if (result.decisions.length === 0) {
        return {
          found: false,
          message: `No decisions found for tags: ${tags.join(", ")}`,
          searchedTags: tags,
          tip: "Try broader tags or check spec/decisions/ directory",
        };
      }

      return {
        found: true,
        total: result.total,
        searchedTags: tags,
        decisions: result.decisions.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          date: d.date,
          tags: d.tags,
          context: d.context.slice(0, 200) + (d.context.length > 200 ? "..." : ""),
          decision: d.decision,
          consequences: d.consequences,
          relatedDecisions: d.relatedDecisions,
        })),
        tip: "Follow these decisions for consistency. Use mandu.decision.save if you make a new architectural choice.",
      };
    },

    "mandu.decision.save": async (args: Record<string, unknown>) => {
      const { title, tags, context, decision, consequences, status } = args as {
        title: string;
        tags: string[];
        context: string;
        decision: string;
        consequences: string[];
        status?: DecisionStatus;
      };

      // Validate required fields
      if (!title || !tags || !context || !decision || !consequences) {
        return {
          error: "Missing required fields",
          required: ["title", "tags", "context", "decision", "consequences"],
        };
      }

      // Get next ID
      const id = await getNextDecisionId(projectRoot);

      // Save decision
      const newDecision: Omit<ArchitectureDecision, "date"> = {
        id,
        title,
        status: status || "proposed",
        tags: tags.map((t) => t.toLowerCase()),
        context,
        decision,
        consequences,
      };

      const result = await saveDecision(projectRoot, newDecision);

      return {
        success: result.success,
        decision: {
          id,
          title,
          status: status || "proposed",
          tags,
        },
        filePath: result.filePath,
        message: result.message,
        tip: "Decision saved. It will be found when searching for related tags.",
      };
    },

    "mandu.decision.check": async (args: Record<string, unknown>) => {
      const { intent, tags } = args as {
        intent: string;
        tags: string[];
      };

      if (!intent || !tags || tags.length === 0) {
        return {
          error: "Intent and tags are required",
          tip: "Describe what you're trying to do and provide related tags",
        };
      }

      const result = await checkConsistency(projectRoot, intent, tags);

      return {
        consistent: result.consistent,
        intent,
        checkedTags: tags,
        relatedDecisions: result.relatedDecisions.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          decision: d.decision.slice(0, 150) + "...",
        })),
        warnings: result.warnings,
        suggestions: result.suggestions,
        tip: result.consistent
          ? "No conflicts found. Proceed with implementation following the suggestions."
          : "⚠️ Review warnings before proceeding. Some decisions may conflict.",
      };
    },

    "mandu.decision.architecture": async () => {
      const compact = await getCompactArchitecture(projectRoot);

      if (!compact) {
        return {
          found: false,
          message: "No architecture information found",
          tip: "Save some decisions first using mandu.decision.save",
        };
      }

      return {
        found: true,
        project: compact.project,
        lastUpdated: compact.lastUpdated,
        summary: {
          totalDecisions: compact.keyDecisions.length,
          topTags: Object.entries(compact.tagCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count })),
        },
        keyDecisions: compact.keyDecisions,
        rules: compact.rules,
        tip: "Use mandu.decision.list with specific tags for detailed information.",
      };
    },
  };

  // Backward-compatible aliases (deprecated)
  handlers["mandu_get_decisions"] = handlers["mandu.decision.list"];
  handlers["mandu_save_decision"] = handlers["mandu.decision.save"];
  handlers["mandu_check_consistency"] = handlers["mandu.decision.check"];
  handlers["mandu_get_architecture"] = handlers["mandu.decision.architecture"];

  return handlers;
}
