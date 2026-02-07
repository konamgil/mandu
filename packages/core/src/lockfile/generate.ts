/**
 * Mandu Lockfile 생성 🔐
 *
 * 설정 파일에서 lockfile 생성
 */

import { computeConfigHash, normalizeForHash } from "../utils/hasher.js";
import {
  type ManduLockfile,
  type LockfileGenerateOptions,
  LOCKFILE_SCHEMA_VERSION,
} from "./types.js";

// ============================================
// Lockfile 생성
// ============================================

/**
 * 설정에서 Lockfile 생성
 *
 * @example
 * ```typescript
 * const config = await loadConfig();
 * const lockfile = generateLockfile(config, {
 *   manduVersion: "0.9.46",
 *   includeSnapshot: true,
 * });
 * ```
 */
export function generateLockfile(
  config: Record<string, unknown>,
  options: LockfileGenerateOptions = {},
  mcpConfig?: Record<string, unknown> | null
): ManduLockfile {
  const {
    manduVersion = getManduVersion(),
    environment = detectEnvironment(),
    includeSnapshot = false,
    includeMcpServerHashes = true,
  } = options;

  // 설정 해시 계산
  const configHash = computeConfigHash(config);

  // MCP 설정 해시 (있는 경우)
  const { mcpHashSource, mcpServers } = resolveMcpSources(config, mcpConfig);
  let mcpConfigHash: string | undefined;
  let mcpServerHashes: ManduLockfile["mcpServers"];

  if (mcpHashSource && Object.keys(mcpHashSource).length > 0) {
    mcpConfigHash = computeConfigHash(mcpHashSource);

    if (includeMcpServerHashes && mcpServers) {
      mcpServerHashes = {};
      for (const [name, serverConfig] of Object.entries(mcpServers)) {
        mcpServerHashes[name] = {
          hash: computeConfigHash(serverConfig),
          version: extractServerVersion(serverConfig),
        };
      }
    }
  }

  // Lockfile 생성
  const lockfile: ManduLockfile = {
    schemaVersion: LOCKFILE_SCHEMA_VERSION,
    manduVersion,
    configHash,
    generatedAt: new Date().toISOString(),
    environment,
  };

  // 선택적 필드 추가
  if (mcpConfigHash) {
    lockfile.mcpConfigHash = mcpConfigHash;
  }

  if (mcpServerHashes) {
    lockfile.mcpServers = mcpServerHashes;
  }

  if (includeSnapshot) {
    const normalized = normalizeForHash(config);
    const snapshotConfig =
      normalized && typeof normalized === "object"
        ? (normalized as Record<string, unknown>)
        : {};

    if (mcpServers) {
      const normalizedMcp = normalizeForHash(mcpServers);
      if (normalizedMcp !== undefined) {
        snapshotConfig.mcpServers = normalizedMcp;
      }
    }

    lockfile.snapshot = {
      config: snapshotConfig,
      environment: environment ?? "development",
    };
  }

  return lockfile;
}

/**
 * MCP 설정에서 별도 Lockfile 데이터 생성
 */
export function generateMcpLockData(
  mcpConfig: Record<string, unknown>
): { hash: string; servers: ManduLockfile["mcpServers"] } {
  const { mcpHashSource, mcpServers } = resolveMcpSources({}, mcpConfig);
  const hash = mcpHashSource ? computeConfigHash(mcpHashSource) : computeConfigHash(mcpConfig);
  const servers: ManduLockfile["mcpServers"] = {};

  if (mcpServers) {
    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      servers[name] = {
        hash: computeConfigHash(serverConfig),
        version: extractServerVersion(serverConfig),
      };
    }
  }

  return { hash, servers };
}

// ============================================
// 유틸리티
// ============================================

/**
 * mandu 버전 가져오기
 */
function getManduVersion(): string {
  // 실제 구현에서는 package.json에서 읽거나 빌드 시 주입
  try {
    // @ts-ignore - 빌드 시 주입되는 값
    if (typeof __MANDU_VERSION__ !== "undefined") {
      // @ts-ignore
      return __MANDU_VERSION__;
    }
  } catch {
    // ignore
  }

  // 기본값
  return "0.0.0";
}

/**
 * 현재 환경 감지
 */
function detectEnvironment(): "development" | "production" | "ci" {
  // CI 환경 감지
  if (
    process.env.CI === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.GITLAB_CI === "true" ||
    process.env.JENKINS_URL
  ) {
    return "ci";
  }

  // NODE_ENV 기반
  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  return "development";
}

/**
 * 서버 설정에서 버전 추출
 */
function extractServerVersion(
  serverConfig: unknown
): string | undefined {
  if (typeof serverConfig !== "object" || serverConfig === null) {
    return undefined;
  }

  const config = serverConfig as Record<string, unknown>;

  // version 필드 직접 확인
  if (typeof config.version === "string") {
    return config.version;
  }

  // args에서 버전 패턴 추출 시도 (예: @package/name@1.2.3)
  if (Array.isArray(config.args)) {
    for (const arg of config.args) {
      if (typeof arg === "string") {
        const match = arg.match(/@[\w-]+\/[\w-]+@([\d.]+)/);
        if (match) {
          return match[1];
        }
      }
    }
  }

  return undefined;
}

// ============================================
// 해시 재계산
// ============================================

/**
 * 현재 설정의 해시만 빠르게 계산
 */
export function computeCurrentHashes(
  config: Record<string, unknown>,
  mcpConfig?: Record<string, unknown> | null
): { configHash: string; mcpConfigHash?: string } {
  const configHash = computeConfigHash(config);

  const { mcpHashSource } = resolveMcpSources(config, mcpConfig);
  const mcpConfigHash = mcpHashSource && Object.keys(mcpHashSource).length > 0
    ? computeConfigHash(mcpHashSource)
    : undefined;

  return { configHash, mcpConfigHash };
}

// ============================================
// MCP 설정 해석
// ============================================

export function resolveMcpSources(
  config: Record<string, unknown>,
  mcpConfig?: Record<string, unknown> | null
): {
  mcpHashSource?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
} {
  if (mcpConfig && typeof mcpConfig === "object") {
    const mcpServers = (mcpConfig as Record<string, unknown>).mcpServers;
    if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
      return {
        mcpHashSource: mcpConfig,
        mcpServers: mcpServers as Record<string, unknown>,
      };
    }
    return {
      mcpHashSource: mcpConfig,
      mcpServers: mcpConfig,
    };
  }

  const configServers = config.mcpServers as Record<string, unknown> | undefined;
  if (configServers && typeof configServers === "object") {
    return {
      mcpHashSource: configServers,
      mcpServers: configServers,
    };
  }

  return {};
}
