/**
 * Mandu Contract Guard
 * Contract-Slot 일관성 검사
 */

import type { RoutesManifest } from "../spec/schema";
import type { GuardViolation } from "./rules";
import path from "path";
import fs from "fs/promises";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return null;
  }
}

/**
 * Extract HTTP methods from contract file content
 * Looks for patterns like: GET: {, POST: {, etc.
 */
function extractContractMethods(content: string): string[] {
  const methods: string[] = [];
  const methodPattern = /\b(GET|POST|PUT|PATCH|DELETE)\s*:\s*\{/g;
  let match;

  while ((match = methodPattern.exec(content)) !== null) {
    if (!methods.includes(match[1])) {
      methods.push(match[1]);
    }
  }

  return methods;
}

/**
 * Extract HTTP methods from slot file content
 * Looks for patterns like: .get(, .post(, etc.
 */
function extractSlotMethods(content: string): string[] {
  const methods: string[] = [];
  const methodPattern = /\.(get|post|put|patch|delete)\s*\(/gi;
  let match;

  while ((match = methodPattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    if (!methods.includes(method)) {
      methods.push(method);
    }
  }

  return methods;
}

/**
 * Contract-Slot consistency violations
 */
export interface ContractViolation extends GuardViolation {
  routeId: string;
  contractPath?: string;
  slotPath?: string;
  missingMethods?: string[];
  undocumentedMethods?: string[];
}

/**
 * Check if API route has a contract defined
 * Rule: API routes should have contracts for type safety
 */
export async function checkMissingContract(
  manifest: RoutesManifest,
  rootDir: string
): Promise<ContractViolation[]> {
  const violations: ContractViolation[] = [];

  for (const route of manifest.routes) {
    // Only check API routes
    if (route.kind !== "api") continue;

    // Skip if no slot (simple routes don't need contracts)
    if (!route.slotModule) continue;

    // Check if contract is defined
    if (!route.contractModule) {
      violations.push({
        ruleId: "CONTRACT_MISSING",
        routeId: route.id,
        file: route.slotModule,
        message: `API 라우트 "${route.id}"에 contract가 정의되지 않았습니다`,
        suggestion: `spec/contracts/${route.id}.contract.ts 파일을 생성하고 manifest에 contractModule을 추가하세요`,
      });
    }
  }

  return violations;
}

/**
 * Check if contract file exists
 */
export async function checkContractFileExists(
  manifest: RoutesManifest,
  rootDir: string
): Promise<ContractViolation[]> {
  const violations: ContractViolation[] = [];

  for (const route of manifest.routes) {
    if (route.contractModule) {
      const contractPath = path.join(rootDir, route.contractModule);
      const exists = await fileExists(contractPath);

      if (!exists) {
        violations.push({
          ruleId: "CONTRACT_NOT_FOUND",
          routeId: route.id,
          file: route.contractModule,
          contractPath: route.contractModule,
          message: `Contract 파일을 찾을 수 없습니다 (routeId: ${route.id})`,
          suggestion: "mandu generate를 실행하여 contract 파일을 생성하세요",
        });
      }
    }
  }

  return violations;
}

/**
 * Check Contract-Slot method consistency
 * - Contract에 정의된 메서드는 Slot에 구현되어야 함
 * - Slot에 구현된 메서드는 Contract에 정의되어야 함
 */
export async function checkContractSlotConsistency(
  manifest: RoutesManifest,
  rootDir: string
): Promise<ContractViolation[]> {
  const violations: ContractViolation[] = [];

  for (const route of manifest.routes) {
    // Need both contract and slot for consistency check
    if (!route.contractModule || !route.slotModule) continue;

    const contractPath = path.join(rootDir, route.contractModule);
    const slotPath = path.join(rootDir, route.slotModule);

    const contractContent = await readFileContent(contractPath);
    const slotContent = await readFileContent(slotPath);

    // Skip if files don't exist (other rules will catch this)
    if (!contractContent || !slotContent) continue;

    const contractMethods = extractContractMethods(contractContent);
    const slotMethods = extractSlotMethods(slotContent);

    // Check for methods in contract but not in slot
    const missingInSlot = contractMethods.filter((m) => !slotMethods.includes(m));
    if (missingInSlot.length > 0) {
      violations.push({
        ruleId: "CONTRACT_METHOD_NOT_IMPLEMENTED",
        routeId: route.id,
        file: route.slotModule,
        contractPath: route.contractModule,
        slotPath: route.slotModule,
        missingMethods: missingInSlot,
        message: `Contract에 정의된 메서드가 Slot에 구현되지 않았습니다: ${missingInSlot.join(", ")}`,
        suggestion: `${route.slotModule}에 .${missingInSlot.map((m) => m.toLowerCase()).join("(), .")}() 핸들러를 추가하세요`,
      });
    }

    // Check for methods in slot but not in contract (warning)
    const undocumented = slotMethods.filter((m) => !contractMethods.includes(m));
    if (undocumented.length > 0) {
      violations.push({
        ruleId: "CONTRACT_METHOD_UNDOCUMENTED",
        routeId: route.id,
        file: route.contractModule,
        contractPath: route.contractModule,
        slotPath: route.slotModule,
        undocumentedMethods: undocumented,
        message: `Slot에 구현된 메서드가 Contract에 문서화되지 않았습니다: ${undocumented.join(", ")}`,
        suggestion: `${route.contractModule}에 ${undocumented.join(", ")} 스키마를 추가하세요`,
      });
    }
  }

  return violations;
}

/**
 * Run all contract-related guard checks
 */
export async function runContractGuardCheck(
  manifest: RoutesManifest,
  rootDir: string
): Promise<ContractViolation[]> {
  const violations: ContractViolation[] = [];

  // Check missing contracts (warning level)
  const missingContracts = await checkMissingContract(manifest, rootDir);
  violations.push(...missingContracts);

  // Check contract file exists
  const notFoundContracts = await checkContractFileExists(manifest, rootDir);
  violations.push(...notFoundContracts);

  // Check contract-slot consistency
  const consistencyViolations = await checkContractSlotConsistency(manifest, rootDir);
  violations.push(...consistencyViolations);

  return violations;
}
