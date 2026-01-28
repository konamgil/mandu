import type { RoutesManifest, RouteSpec } from "../spec/schema";
import { generateApiHandler, generatePageComponent, generateSlotLogic } from "./templates";
import { generateContractTypeGlue, generateContractTemplate, generateContractTypesIndex } from "./contract-glue";
import { computeHash } from "../spec/lock";
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

export interface GenerateResult {
  success: boolean;
  created: string[];
  deleted: string[];
  skipped: string[];
  errors: string[];
  /** 삭제 실패 등 치명적이지 않은 경고 */
  warnings: string[];
}

/**
 * Spec 파일 정보
 */
export interface SpecSource {
  /** Spec 파일 경로 */
  path: string;
  /** SHA256 해시 */
  hash: string;
}

/**
 * Spec 내 라우트 위치 정보
 */
export interface SpecLocation {
  /** Spec 파일 경로 */
  file: string;
  /** routes 배열 내 인덱스 */
  routeIndex: number;
  /** JSON 경로 (예: "routes[0]") */
  jsonPath: string;
}

/**
 * Slot 파일 매핑 정보
 */
export interface SlotMapping {
  /** Slot 파일 경로 */
  slotPath: string;
}

/**
 * Contract 파일 매핑 정보
 */
export interface ContractMapping {
  /** Contract 파일 경로 */
  contractPath: string;
  /** Type glue 파일 경로 */
  typeGluePath: string;
}

/**
 * Generated 파일 엔트리
 */
export interface GeneratedFileEntry {
  /** 라우트 ID */
  routeId: string;
  /** 라우트 종류 */
  kind: "api" | "page";
  /** Spec 내 위치 */
  specLocation: SpecLocation;
  /** Slot 매핑 (있는 경우) */
  slotMapping?: SlotMapping;
  /** Contract 매핑 (있는 경우) */
  contractMapping?: ContractMapping;
}

/**
 * Generated Map 구조
 */
export interface GeneratedMap {
  /** 버전 */
  version: number;
  /** 생성 시각 */
  generatedAt: string;
  /** Spec 소스 정보 */
  specSource: SpecSource;
  /** 생성된 파일 매핑 */
  files: Record<string, GeneratedFileEntry>;
  /** 프레임워크 내부 파일 패턴 */
  frameworkPaths: string[];
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // ignore if exists
  }
}

async function getExistingFiles(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(".route.ts") || f.endsWith(".route.tsx"));
  } catch {
    return [];
  }
}

async function getTypeFiles(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(".types.ts") || f === "index.ts");
  } catch {
    return [];
  }
}

export async function generateRoutes(
  manifest: RoutesManifest,
  rootDir: string
): Promise<GenerateResult> {
  const result: GenerateResult = {
    success: true,
    created: [],
    deleted: [],
    skipped: [],
    errors: [],
    warnings: [],
  };

  const serverRoutesDir = path.join(rootDir, "apps/server/generated/routes");
  const webRoutesDir = path.join(rootDir, "apps/web/generated/routes");
  const typesDir = path.join(rootDir, "apps/server/generated/types");
  const mapDir = path.join(rootDir, "packages/core/map");

  await ensureDir(serverRoutesDir);
  await ensureDir(webRoutesDir);
  await ensureDir(typesDir);
  await ensureDir(mapDir);

  const generatedMap: GeneratedMap = {
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    specSource: {
      path: "spec/routes.manifest.json",
      hash: computeHash(manifest),
    },
    files: {},
    frameworkPaths: [
      "@mandujs/core",
      "packages/core/src",
      "node_modules/@mandujs",
    ],
  };

  const expectedServerFiles = new Set<string>();
  const expectedWebFiles = new Set<string>();
  const expectedTypeFiles = new Set<string>();
  const routesWithContracts: string[] = [];

  for (let routeIndex = 0; routeIndex < manifest.routes.length; routeIndex++) {
    const route = manifest.routes[routeIndex];

    try {
      // Spec 위치 정보
      const specLocation: SpecLocation = {
        file: "spec/routes.manifest.json",
        routeIndex,
        jsonPath: `routes[${routeIndex}]`,
      };

      // Slot 매핑 정보 (있는 경우)
      const slotMapping: SlotMapping | undefined = route.slotModule
        ? { slotPath: route.slotModule }
        : undefined;

      // Contract 매핑 정보 (있는 경우)
      let contractMapping: ContractMapping | undefined;

      // Server handler
      const serverFileName = `${route.id}.route.ts`;
      const serverFilePath = path.join(serverRoutesDir, serverFileName);
      expectedServerFiles.add(serverFileName);

      const handlerContent = generateApiHandler(route);
      await Bun.write(serverFilePath, handlerContent);
      result.created.push(serverFilePath);

      // Contract file (only if contractModule is specified)
      if (route.contractModule) {
        const contractFilePath = path.join(rootDir, route.contractModule);
        const contractDir = path.dirname(contractFilePath);

        await ensureDir(contractDir);

        // contract 파일이 이미 존재하면 덮어쓰지 않음 (사용자 코드 보존)
        const contractExists = await fileExists(contractFilePath);
        if (!contractExists) {
          const contractContent = generateContractTemplate(route);
          await Bun.write(contractFilePath, contractContent);
          result.created.push(contractFilePath);
        } else {
          result.skipped.push(contractFilePath);
        }

        // Generate type glue
        const typeFileName = `${route.id}.types.ts`;
        const typeFilePath = path.join(typesDir, typeFileName);
        expectedTypeFiles.add(typeFileName);

        const typeGlueContent = generateContractTypeGlue(route, "apps/server/generated/types");
        await Bun.write(typeFilePath, typeGlueContent);
        result.created.push(typeFilePath);

        contractMapping = {
          contractPath: route.contractModule,
          typeGluePath: `apps/server/generated/types/${typeFileName}`,
        };

        routesWithContracts.push(route.id);
      }

      generatedMap.files[`apps/server/generated/routes/${serverFileName}`] = {
        routeId: route.id,
        kind: route.kind as "api" | "page",
        specLocation,
        slotMapping,
        contractMapping,
      };

      // Slot file (only if slotModule is specified)
      if (route.slotModule) {
        const slotFilePath = path.join(rootDir, route.slotModule);
        const slotDir = path.dirname(slotFilePath);

        await ensureDir(slotDir);

        // slot 파일이 이미 존재하면 덮어쓰지 않음 (사용자 코드 보존)
        const slotExists = await fileExists(slotFilePath);
        if (!slotExists) {
          const slotContent = generateSlotLogic(route);
          await Bun.write(slotFilePath, slotContent);
          result.created.push(slotFilePath);
        } else {
          result.skipped.push(slotFilePath);
        }
      }

      // Page component (only for page kind)
      if (route.kind === "page") {
        const webFileName = `${route.id}.route.tsx`;
        const webFilePath = path.join(webRoutesDir, webFileName);
        expectedWebFiles.add(webFileName);

        const componentContent = generatePageComponent(route);
        await Bun.write(webFilePath, componentContent);
        result.created.push(webFilePath);

        generatedMap.files[`apps/web/generated/routes/${webFileName}`] = {
          routeId: route.id,
          kind: route.kind,
          specLocation,
          slotMapping,
          contractMapping,
        };
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        `Failed to generate ${route.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Generate types index if there are contracts
  if (routesWithContracts.length > 0) {
    const typesIndexContent = generateContractTypesIndex(routesWithContracts);
    const typesIndexPath = path.join(typesDir, "index.ts");
    await Bun.write(typesIndexPath, typesIndexContent);
    result.created.push(typesIndexPath);
  }

  // Clean up stale files
  const existingServerFiles = await getExistingFiles(serverRoutesDir);
  for (const file of existingServerFiles) {
    if (!expectedServerFiles.has(file)) {
      const filePath = path.join(serverRoutesDir, file);
      try {
        await fs.unlink(filePath);
        result.deleted.push(filePath);
      } catch (error) {
        result.warnings.push(
          `Failed to delete ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  const existingWebFiles = await getExistingFiles(webRoutesDir);
  for (const file of existingWebFiles) {
    if (!expectedWebFiles.has(file)) {
      const filePath = path.join(webRoutesDir, file);
      try {
        await fs.unlink(filePath);
        result.deleted.push(filePath);
      } catch (error) {
        result.warnings.push(
          `Failed to delete ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // Clean up stale type files
  const existingTypeFiles = await getTypeFiles(typesDir);
  for (const file of existingTypeFiles) {
    if (!expectedTypeFiles.has(file) && file !== "index.ts") {
      const filePath = path.join(typesDir, file);
      try {
        await fs.unlink(filePath);
        result.deleted.push(filePath);
      } catch (error) {
        result.warnings.push(
          `Failed to delete ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // Write generated map
  const mapPath = path.join(mapDir, "generated.map.json");
  await Bun.write(mapPath, JSON.stringify(generatedMap, null, 2));

  return result;
}
