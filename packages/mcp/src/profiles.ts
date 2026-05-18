/**
 * MCP Tool Profiles
 *
 * Controls how many tool categories are exposed to AI agents.
 * - agent-core: Canonical agent workflow plus docs grounding (default)
 * - agent-full: Agent workflow plus Mandu domain tools
 * - internal: All categories, no filtering
 */

export type McpProfile = "agent-core" | "agent-full" | "internal";

export const PROFILE_CATEGORIES: Record<McpProfile, string[] | null> = {
  "agent-core": ["agent", "docs"],
  "agent-full": [
    "agent",
    "docs",
    "spec",
    "generate",
    "slot",
    "slot-validation",
    "hydration",
    "contract",
    "guard",
    "run-tests",
    "lint",
  ],
  internal: null,
};

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
