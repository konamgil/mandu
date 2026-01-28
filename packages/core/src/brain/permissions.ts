/**
 * Brain v0.1 - Permission Verification
 *
 * Ensures Brain operates safely within defined boundaries.
 * Brain never blocks operations - only warns and suggests.
 */

import type { BrainPolicy, EnvironmentInfo, PatchSuggestion } from "./types";
import { DEFAULT_BRAIN_POLICY } from "./types";

/**
 * CI environment detection patterns
 */
const CI_ENVIRONMENT_VARS = [
  "CI",
  "CONTINUOUS_INTEGRATION",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "JENKINS_URL",
  "BUILDKITE",
  "TEAMCITY_VERSION",
  "AZURE_PIPELINES",
  "BITBUCKET_PIPELINES",
] as const;

/**
 * CI provider detection
 */
const CI_PROVIDERS: Record<string, string> = {
  GITHUB_ACTIONS: "GitHub Actions",
  GITLAB_CI: "GitLab CI",
  CIRCLECI: "CircleCI",
  TRAVIS: "Travis CI",
  JENKINS_URL: "Jenkins",
  BUILDKITE: "Buildkite",
  TEAMCITY_VERSION: "TeamCity",
  AZURE_PIPELINES: "Azure Pipelines",
  BITBUCKET_PIPELINES: "Bitbucket Pipelines",
};

/**
 * Safe file patterns that Brain can suggest modifications to
 */
const SAFE_FILE_PATTERNS = [
  /^spec\/slots\/.+\.slot\.ts$/,
  /^spec\/contracts\/.+\.contract\.ts$/,
  /^spec\/routes\.manifest\.json$/,
  /^mandu\.config\.(ts|js|json)$/,
] as const;

/**
 * Protected file patterns that Brain should never suggest modifying
 */
const PROTECTED_FILE_PATTERNS = [
  /^generated\//,
  /node_modules\//,
  /\.git\//,
  /package-lock\.json$/,
  /bun\.lockb$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
] as const;

/**
 * Dangerous commands that require extra confirmation
 */
const DANGEROUS_COMMANDS = [
  "rm -rf",
  "git push --force",
  "git reset --hard",
  "DROP TABLE",
  "DELETE FROM",
] as const;

/**
 * Detect the current environment
 */
export function detectEnvironment(): EnvironmentInfo {
  const env = typeof process !== "undefined" ? process.env : {};

  // Check for CI environment
  let isCI = false;
  let ciProvider: string | undefined;

  for (const envVar of CI_ENVIRONMENT_VARS) {
    if (env[envVar]) {
      isCI = true;
      if (CI_PROVIDERS[envVar]) {
        ciProvider = CI_PROVIDERS[envVar];
      }
      break;
    }
  }

  // Check if generic CI is set
  if (!ciProvider && (env.CI === "true" || env.CI === "1")) {
    isCI = true;
    ciProvider = "Unknown CI";
  }

  // Check for development environment
  const isDevelopment =
    !isCI &&
    (env.NODE_ENV === "development" ||
      env.NODE_ENV === undefined ||
      env.NODE_ENV === "");

  return {
    isCI,
    ciProvider,
    isDevelopment,
    modelAvailable: false, // Will be set by Brain after adapter check
  };
}

/**
 * Determine if Brain should be enabled based on policy and environment
 */
export function shouldEnableBrain(
  policy: BrainPolicy = DEFAULT_BRAIN_POLICY,
  env?: EnvironmentInfo
): boolean {
  const environment = env ?? detectEnvironment();

  // Explicit override
  if (policy.enabled === "always") return true;
  if (policy.enabled === "never") return false;

  // Auto mode: disable in CI
  if (environment.isCI && !policy.ci) {
    return false;
  }

  // Auto mode: enable locally
  if (environment.isDevelopment) {
    if (environment.modelAvailable) {
      return policy.localWithModel;
    }
    return policy.localNoModel !== "disabled";
  }

  return false;
}

/**
 * Check if a file path is safe for Brain to suggest modifications
 */
export function isSafeForModification(filePath: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Check protected patterns first
  for (const pattern of PROTECTED_FILE_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return false;
    }
  }

  // Check if it matches safe patterns
  for (const pattern of SAFE_FILE_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return true;
    }
  }

  // Default: not safe (conservative approach)
  return false;
}

/**
 * Check if a command is dangerous and needs confirmation
 */
export function isDangerousCommand(command: string): boolean {
  const normalizedCommand = command.toLowerCase().trim();

  for (const dangerous of DANGEROUS_COMMANDS) {
    if (normalizedCommand.includes(dangerous.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a patch suggestion for safety
 */
export interface PatchValidation {
  valid: boolean;
  reason?: string;
  requiresConfirmation: boolean;
}

export function validatePatchSuggestion(
  patch: PatchSuggestion
): PatchValidation {
  // Check file safety for modify operations
  if (patch.type === "modify" || patch.type === "add") {
    if (!isSafeForModification(patch.file)) {
      return {
        valid: false,
        reason: `File '${patch.file}' is not safe for automatic modification`,
        requiresConfirmation: false,
      };
    }
  }

  // Check command safety
  if (patch.type === "command" && patch.command) {
    if (isDangerousCommand(patch.command)) {
      return {
        valid: true,
        reason: `Command '${patch.command}' is potentially dangerous`,
        requiresConfirmation: true,
      };
    }
  }

  // Check confidence threshold
  if (patch.confidence < 0.3) {
    return {
      valid: true,
      reason: "Low confidence suggestion",
      requiresConfirmation: true,
    };
  }

  return {
    valid: true,
    requiresConfirmation: false,
  };
}

/**
 * Filter patch suggestions to only include safe ones
 */
export function filterSafePatchSuggestions(
  patches: PatchSuggestion[]
): PatchSuggestion[] {
  return patches.filter((patch) => {
    const validation = validatePatchSuggestion(patch);
    return validation.valid;
  });
}

/**
 * Create an isolated execution context for Brain operations
 * Ensures Brain failures don't affect Core functionality
 */
export async function isolatedBrainExecution<T>(
  operation: () => Promise<T>,
  fallback: T
): Promise<{ result: T; error?: Error }> {
  try {
    const result = await operation();
    return { result };
  } catch (error) {
    // Log error but don't propagate
    console.error(
      "[Brain] Isolated error:",
      error instanceof Error ? error.message : error
    );
    return {
      result: fallback,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
