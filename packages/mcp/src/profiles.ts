/**
 * MCP Tool Profiles
 *
 * Controls how many tool categories are exposed to AI agents.
 * - minimal: Core scaffolding tools only (~15 tools)
 * - standard: Common development workflow (~40 tools)
 * - full: All categories, no filtering (default)
 */

export type McpProfile = "minimal" | "standard" | "full";

export const PROFILE_CATEGORIES: Record<McpProfile, string[] | null> = {
  minimal: ["spec", "project", "guard", "generate"],
  standard: [
    "spec", "project", "guard", "generate",
    "contract", "slot", "hydration", "seo",
    "component", "kitchen", "composite",
  ],
  full: null,
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
  return value === "minimal" || value === "standard" || value === "full";
}
