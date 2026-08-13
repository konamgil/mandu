/**
 * MCP Tool Profiles
 *
 * Controls how many tool categories are exposed to AI agents.
 * - agent-core: Canonical agent workflow plus docs grounding (default)
 * - agent-full: Deprecated compatibility alias of agent-core
 * - internal: All categories, no filtering
 */

export type McpProfile = "agent-core" | "agent-full" | "internal";

export const PROFILE_CATEGORIES: Record<McpProfile, string[] | null> = {
  "agent-core": ["agent", "docs"],
  "agent-full": ["agent", "docs"],
  internal: null,
};

/**
 * Categories intentionally hidden from every agent-facing profile.
 *
 * Every new tool category in `TOOL_MODULES` MUST be classified into one of:
 *   - `PROFILE_CATEGORIES["agent-core"]` — canonical agent loop
 *   - `PROFILE_CATEGORIES["agent-full"]` — domain work for agents
 *   - `EXPERT_ONLY_CATEGORIES`           — internal plumbing
 *
 * `profile-coverage.test.ts` fails CI if a new category is left unclassified,
 * preventing silent default-profile bloat over time.
 */
export const EXPERT_ONLY_CATEGORIES: ReadonlySet<string> = new Set([
  // Low-level action handlers. Agent-facing clients use mandu.agent.*.
  "spec",
  "generate",
  "composite",
  "slot",
  "slot-validation",
  "hydration",
  "contract",
  "design",
  "seo",
  "guard",
  "lint",
  "run-tests",
  "refactor-barrel",
  "refactor-routes",
  "refactor-contract",
  // Transactional state / framework internals
  "transaction",
  "history",
  "decisions",
  "negotiate",
  // Runtime / project introspection
  "brain",
  "runtime",
  "project",
  "resource",
  // Devtools / kitchen
  "kitchen",
  "component",
  // Agent loop internal helpers (used by mandu.agent.*, not by agents directly)
  "ai-brief",
]);

/**
 * Returns allowed category names for a profile, or null if all categories are allowed.
 */
export function getProfileCategories(profile: McpProfile): string[] | null {
  return PROFILE_CATEGORIES[profile] ?? null;
}

/**
 * Type guard for valid profile strings.
 */
export function isValidProfile(value: string): value is McpProfile {
  return value === "agent-core" || value === "agent-full" || value === "internal";
}

/**
 * Resolve current and legacy profile names to the new official profile set.
 */
export function resolveMcpProfile(
  value: string | undefined,
  fallback: McpProfile = "agent-core",
): McpProfile {
  if (!value) return fallback;
  if (isValidProfile(value)) return value;
  if (value === "minimal") return "agent-core";
  if (value === "standard") return "agent-full";
  if (value === "full") return "internal";
  return fallback;
}
