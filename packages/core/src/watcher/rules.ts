/**
 * Brain v0.1 - Watch Architecture Rules
 *
 * 5 MVP rules that catch the most common mistakes.
 * Rules only warn - they never block operations.
 */

import type { ArchRule, WatchWarning } from "../brain/types";
import path from "path";
import fs from "fs/promises";

/**
 * The 5 MVP Architecture Rules
 *
 * These rules cover the most frequent mistakes in Mandu projects:
 * 1. Direct modification of generated files
 * 2. Slot files in wrong locations
 * 3. Slot file naming convention
 * 4. Contract file naming convention
 * 5. Forbidden imports in generated files
 */
export const MVP_RULES: ArchRule[] = [
  {
    id: "GENERATED_DIRECT_EDIT",
    name: "Generated Direct Edit",
    description: "Generated 파일은 직접 수정하면 안 됩니다",
    pattern: "**/generated/**",
    action: "warn",
    message: "Generated 파일이 직접 수정되었습니다. 이 파일은 `mandu generate`로 재생성됩니다.",
    agentAction: "regenerate",
    agentCommand: "mandu_generate",
  },
  {
    id: "WRONG_SLOT_LOCATION",
    name: "Wrong Slot Location",
    description: "Slot 파일은 spec/slots/ 디렉토리에 있어야 합니다",
    pattern: "**/*.slot.ts",
    action: "warn",
    message: "Slot 파일이 잘못된 위치에 있습니다. spec/slots/ 디렉토리로 이동하세요.",
    excludePattern: "spec/slots/**",
    agentAction: "move",
    agentCommand: "mandu_check_location",
  },
  {
    id: "SLOT_NAMING",
    name: "Slot Naming Convention",
    description: "Slot 파일은 .slot.ts로 끝나야 합니다",
    pattern: "spec/slots/*.ts",
    action: "warn",
    message: "Slot 파일명이 .slot.ts로 끝나야 합니다.",
    mustEndWith: ".slot.ts",
    agentAction: "rename",
    agentCommand: "mandu_check_location",
  },
  {
    id: "CONTRACT_NAMING",
    name: "Contract Naming Convention",
    description: "Contract 파일은 .contract.ts로 끝나야 합니다",
    pattern: "spec/contracts/*.ts",
    action: "warn",
    message: "Contract 파일명이 .contract.ts로 끝나야 합니다.",
    mustEndWith: ".contract.ts",
    agentAction: "rename",
    agentCommand: "mandu_check_location",
  },
  {
    id: "FORBIDDEN_IMPORT",
    name: "Forbidden Import in Generated",
    description: "Generated 파일에서 금지된 모듈 import",
    pattern: "**/generated/**",
    action: "warn",
    message: "Generated 파일에서 금지된 모듈이 import되었습니다.",
    forbiddenImports: ["fs", "child_process", "cluster", "worker_threads"],
    agentAction: "remove_import",
    agentCommand: "mandu_guard_check",
  },
  {
    id: "SLOT_MODIFIED",
    name: "Slot File Modified",
    description: "Slot 파일이 수정되었습니다",
    pattern: "spec/slots/*.slot.ts",
    action: "warn",
    message: "Slot 수정 감지. mandu_validate_slot 또는 mandu_guard_check로 검증하세요.",
    agentAction: "validate",
    agentCommand: "mandu_validate_slot",
  },
  {
    id: "ISLAND_FIRST_MODIFIED",
    name: "Island-First ComponentModule Modified",
    description: "Island-First 방식으로 생성된 componentModule이 수동으로 변경되었습니다",
    pattern: "apps/web/generated/routes/**",
    action: "warn",
    message: "Island-First componentModule이 수동 수정되었습니다. mandu generate를 실행하세요.",
    agentAction: "regenerate",
    agentCommand: "mandu_generate",
  },
];

/**
 * Get all rules as a map by ID
 */
export function getRulesMap(): Map<string, ArchRule> {
  const map = new Map<string, ArchRule>();
  for (const rule of MVP_RULES) {
    map.set(rule.id, rule);
  }
  return map;
}

/**
 * Simple glob pattern matching
 *
 * Supports:
 * - ** for any path segment(s)
 * - * for any characters in a single segment
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob to regex
  const regexPattern = normalizedPattern
    .replace(/\*\*/g, "<<DOUBLESTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<DOUBLESTAR>>/g, ".*")
    .replace(/\//g, "\\/");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

/**
 * Check if a file path matches any rule
 */
export function matchRules(filePath: string): ArchRule[] {
  const matched: ArchRule[] = [];

  for (const rule of MVP_RULES) {
    if (matchGlob(rule.pattern, filePath)) {
      // Skip if excluded
      if (rule.excludePattern && matchGlob(rule.excludePattern, filePath)) {
        continue;
      }
      matched.push(rule);
    }
  }

  return matched;
}

/**
 * Check file naming convention
 */
export function checkNamingConvention(
  filePath: string,
  rule: ArchRule
): boolean {
  if (!rule.mustEndWith) return true;

  const fileName = path.basename(filePath);
  return fileName.endsWith(rule.mustEndWith);
}

/**
 * Check for forbidden imports in file content
 */
export async function checkForbiddenImports(
  filePath: string,
  content: string,
  rule: ArchRule
): Promise<string[]> {
  if (!rule.forbiddenImports || rule.forbiddenImports.length === 0) {
    return [];
  }

  const found: string[] = [];

  for (const forbidden of rule.forbiddenImports) {
    const importRegex = new RegExp(
      `import\\s+.*from\\s+['"]${forbidden}['"]|require\\s*\\(\\s*['"]${forbidden}['"]\\s*\\)`,
      "g"
    );

    if (importRegex.test(content)) {
      found.push(forbidden);
    }
  }

  return found;
}

/**
 * Validate a file against all applicable rules
 */
export async function validateFile(
  filePath: string,
  event: "create" | "modify" | "delete",
  rootDir: string
): Promise<WatchWarning[]> {
  const warnings: WatchWarning[] = [];

  // Get relative path from root
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");

  // Find matching rules
  const matchedRules = matchRules(relativePath);

  for (const rule of matchedRules) {
    // Skip delete events for most rules
    if (event === "delete" && rule.id !== "GENERATED_DIRECT_EDIT") {
      continue;
    }

    // Base warning fields reused across all branches
    const base = {
      ruleId: rule.id,
      file: relativePath,
      timestamp: new Date(),
      event,
      agentAction: rule.agentAction,
      agentCommand: rule.agentCommand,
    } as const;

    // Check naming convention
    if (rule.mustEndWith && !checkNamingConvention(relativePath, rule)) {
      warnings.push({ ...base, message: rule.message });
      continue;
    }

    // Check forbidden imports (only for modify/create)
    if (
      rule.forbiddenImports &&
      rule.forbiddenImports.length > 0 &&
      event !== "delete"
    ) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const forbidden = await checkForbiddenImports(
          relativePath,
          content,
          rule
        );

        if (forbidden.length > 0) {
          warnings.push({
            ...base,
            message: `${rule.message} (${forbidden.join(", ")})`,
          });
        }
      } catch {
        // File might not exist or be readable
      }
      continue;
    }

    // Default: generate warning for pattern match
    if (rule.id === "GENERATED_DIRECT_EDIT" || rule.id === "WRONG_SLOT_LOCATION" || rule.id === "ISLAND_FIRST_MODIFIED") {
      warnings.push({ ...base, message: rule.message });
    }

    // Slot modified: info level notification
    if (rule.id === "SLOT_MODIFIED" && event !== "delete") {
      warnings.push({ ...base, message: rule.message, level: "info" as const });
    }
  }

  return warnings;
}

/**
 * Get rule by ID
 */
export function getRule(ruleId: string): ArchRule | undefined {
  return MVP_RULES.find((r) => r.id === ruleId);
}

/**
 * Get all rules
 */
export function getAllRules(): readonly ArchRule[] {
  return MVP_RULES;
}
