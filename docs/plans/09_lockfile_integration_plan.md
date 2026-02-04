# Mandu Lockfile 통합 기획서

> ont-run 기법을 mandu의 기존 기능과 유기적으로 연결하여 **AI-Human 협업의 안전성**을 극대화합니다.

## 목차

1. [통합 개요](#1-통합-개요)
2. [Guard 강화](#2-guard-강화)
3. [Contract 보호](#3-contract-보호)
4. [Change 트랜잭션 연동](#4-change-트랜잭션-연동)
5. [Brain 연동](#5-brain-연동)
6. [DevTools 통합](#6-devtools-통합)
7. [Init 강화](#7-init-강화)
8. [MCP 서버 상태 추적](#8-mcp-서버-상태-추적)
9. [구현 우선순위](#9-구현-우선순위)

---

## 1. 통합 개요

### 1.1 현재 구현된 기능

```
┌─────────────────────────────────────────────────────────┐
│                   ont-run 기법 (Phase 1-4)              │
├─────────────────────────────────────────────────────────┤
│  ✅ hasher.ts      - 결정론적 해싱                      │
│  ✅ differ.ts      - 설정 diff + 민감정보 마스킹        │
│  ✅ lockfile/      - 생성/검증/정책                     │
│  ✅ symbols.ts     - 8개 메타데이터 심볼                │
│  ✅ metadata.ts    - Zod 스키마 메타데이터 유틸         │
│  ✅ mcp-ref.ts     - MCP 참조 헬퍼                      │
│  ✅ lock.ts (CLI)  - mandu lock 명령어                  │
└─────────────────────────────────────────────────────────┘
```

### 1.2 통합 대상 모듈

```
┌─────────────────────────────────────────────────────────┐
│                    mandu 핵심 모듈                       │
├─────────────────────────────────────────────────────────┤
│  🔗 Guard       - 아키텍처 감시 + 설정 무결성           │
│  🔗 Contract    - API 계약 보호 (민감 필드)             │
│  🔗 Change      - 트랜잭션 + lockfile 스냅샷            │
│  🔗 Brain       - 불일치 원인 분석                      │
│  🔗 DevTools    - 실시간 설정 변경 감지                 │
│  🔗 Init        - 프로젝트 생성 시 lockfile 자동화      │
└─────────────────────────────────────────────────────────┘
```

### 1.3 통합 후 데이터 흐름

```
                    ┌──────────────┐
                    │  mandu init  │
                    └──────┬───────┘
                           │ lockfile 자동 생성
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    mandu.config.ts                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ mcpServers: {                                       │ │
│  │   thinking: mcpServerRef("sequential-thinking"),    │ │ ← Symbol 메타데이터
│  │ },                                                  │ │
│  │ apiKey: sensitiveToken(),                           │ │ ← 민감 필드 마킹
│  │ security: protectedField("Human only"),             │ │ ← AI 수정 불가
│  └─────────────────────────────────────────────────────┘ │
└────────────────────────────┬─────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
  ┌───────────┐       ┌───────────┐       ┌───────────┐
  │   Guard   │       │  Change   │       │ DevTools  │
  │ 통합 검증 │       │ 트랜잭션  │       │ 실시간    │
  └─────┬─────┘       └─────┬─────┘       └─────┬─────┘
        │                   │                   │
        │ 불일치 감지       │ 스냅샷 포함       │ 변경 이벤트
        ▼                   ▼                   ▼
  ┌───────────┐       ┌───────────┐       ┌───────────┐
  │   Brain   │       │ Lockfile  │       │   MCP     │
  │ 원인 분석 │       │ 자동 갱신 │       │ 에이전트  │
  └───────────┘       └───────────┘       └───────────┘
```

---

## 2. Guard 강화

### 2.1 개념: 아키텍처 + 설정 무결성 통합 검증

현재 Guard는 **코드 아키텍처**만 검증합니다. Lockfile을 통합하면 **설정 무결성**까지 한 번에 검증할 수 있습니다.

```typescript
// 현재: 코드만 검증
mandu guard

// 통합 후: 코드 + 설정 동시 검증
mandu guard --with-config
mandu check  // 이미 통합 명령어로 확장
```

### 2.2 구현 방안

```typescript
// packages/core/src/guard/config-guard.ts (신규)

import { validateWithPolicy, detectMode } from "../lockfile";
import { validateAndReport } from "../config";

export interface ConfigGuardResult {
  configValid: boolean;
  lockfileValid: boolean;
  errors: ConfigGuardError[];
  warnings: ConfigGuardWarning[];
}

/**
 * 설정 무결성 검증 (Guard 통합용)
 */
export async function guardConfig(
  rootDir: string,
  options?: { mode?: LockfileMode }
): Promise<ConfigGuardResult> {
  const config = await validateAndReport(rootDir);
  if (!config) {
    return {
      configValid: false,
      lockfileValid: false,
      errors: [{ code: "CONFIG_LOAD_FAILED", message: "설정 로드 실패" }],
      warnings: [],
    };
  }

  const lockfile = await readLockfile(rootDir);
  const { result, action, bypassed } = validateWithPolicy(
    config,
    lockfile,
    options?.mode ?? detectMode()
  );

  return {
    configValid: true,
    lockfileValid: result?.valid ?? false,
    errors: result?.errors ?? [],
    warnings: result?.warnings ?? [],
  };
}
```

### 2.3 통합 리포트

```typescript
// packages/core/src/guard/statistics.ts 확장

export interface UnifiedGuardReport {
  // 기존 아키텍처 검증
  architecture: {
    violations: Violation[];
    statistics: LayerStatistics;
  };

  // 신규: 설정 무결성
  config: {
    valid: boolean;
    hash: string;
    diff?: ConfigDiff;
  };

  // 통합 점수
  healthScore: number; // 0-100
}
```

### 2.4 CLI 통합

```bash
# 통합 검증 (아키텍처 + 설정)
mandu check

# 출력 예시:
# ══════════════════════════════════════════
# 🥟 Mandu Health Check
# ══════════════════════════════════════════
#
# Architecture Guard
# ──────────────────────────────────────────
# ✅ 0 violations found
#
# Config Integrity
# ──────────────────────────────────────────
# ✅ Lockfile valid (hash: a1b2c3d4)
#
# Health Score: 100/100
```

---

## 3. Contract 보호

### 3.1 개념: Symbol로 Contract 민감 필드 보호

Contract의 특정 필드를 AI가 수정하지 못하도록 보호합니다.

```typescript
// 현재: 모든 필드 수정 가능
const userContract = Mandu.contract({
  request: {
    POST: {
      body: z.object({
        email: z.string(),
        password: z.string(),  // AI가 마음대로 수정 가능
      }),
    },
  },
});

// 통합 후: 민감 필드 보호
const userContract = Mandu.contract({
  request: {
    POST: {
      body: z.object({
        email: z.string(),
        password: sensitiveToken("password"),  // AI 수정 시 경고
        role: protectedField("Human approval required"),  // AI 수정 불가
      }),
    },
  },
});
```

### 3.2 구현 방안

```typescript
// packages/core/src/contract/protection.ts (신규)

import {
  isSensitiveField,
  isProtectedField,
  getMetadata,
  PROTECTED_FIELD
} from "../config";

/**
 * Contract 스키마에서 보호된 필드 추출
 */
export function extractProtectedFields(
  schema: z.ZodType
): ProtectedFieldInfo[] {
  const fields: ProtectedFieldInfo[] = [];

  // ZodObject 탐색
  if (schema instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(schema.shape)) {
      if (isProtectedField(value as z.ZodType)) {
        const meta = getMetadata(value as z.ZodType, PROTECTED_FIELD);
        fields.push({
          path: key,
          reason: meta?.reason ?? "Protected field",
          allowedModifiers: meta?.allowedModifiers ?? ["human"],
        });
      }

      // 재귀 탐색 (중첩 객체)
      if (value instanceof z.ZodObject) {
        const nested = extractProtectedFields(value);
        fields.push(...nested.map(f => ({
          ...f,
          path: `${key}.${f.path}`,
        })));
      }
    }
  }

  return fields;
}

/**
 * Contract 변경 시 보호 필드 검증
 */
export function validateContractChanges(
  oldContract: ContractSchema,
  newContract: ContractSchema,
  modifier: "human" | "ai"
): ContractChangeValidation {
  const protectedFields = extractProtectedFields(oldContract);
  const violations: ProtectionViolation[] = [];

  for (const field of protectedFields) {
    if (!field.allowedModifiers.includes(modifier)) {
      const oldValue = getFieldValue(oldContract, field.path);
      const newValue = getFieldValue(newContract, field.path);

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        violations.push({
          field: field.path,
          reason: field.reason,
          message: `AI cannot modify protected field: ${field.path}`,
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
```

### 3.3 에이전트 통합

MCP 서버에서 Contract 수정 요청 시 자동 검증:

```typescript
// packages/mcp/src/tools/contract-edit.ts

export const contractEditTool = {
  name: "edit_contract",
  description: "Edit an API contract",

  async execute(params: ContractEditParams) {
    const { contractPath, changes } = params;

    // 보호 필드 검증
    const validation = validateContractChanges(
      currentContract,
      proposedContract,
      "ai"  // AI가 수정 요청
    );

    if (!validation.valid) {
      return {
        success: false,
        error: "PROTECTED_FIELD_VIOLATION",
        violations: validation.violations,
        suggestion: "Request human approval for these changes",
      };
    }

    // 변경 적용...
  },
};
```

---

## 4. Change 트랜잭션 연동

### 4.1 개념: 트랜잭션에 Lockfile 스냅샷 포함

`mandu change begin` 시 설정 스냅샷을 자동으로 포함합니다.

```typescript
// 현재
interface Snapshot {
  manifest: RoutesManifest;
  lock: SpecLock | null;
  slotContents: Record<string, string>;
}

// 통합 후
interface Snapshot {
  manifest: RoutesManifest;
  lock: SpecLock | null;
  slotContents: Record<string, string>;

  // 신규: 설정 상태
  configSnapshot?: {
    lockfile: ManduLockfile;
    configHash: string;
  };
}
```

### 4.2 구현 방안

```typescript
// packages/core/src/change/transaction.ts 확장

import { readLockfile, generateLockfile } from "../lockfile";

export async function beginChange(
  rootDir: string,
  options?: BeginChangeOptions
): Promise<ChangeRecord> {
  // 기존 스냅샷 생성
  const snapshot = await createSnapshot(rootDir);

  // 설정 스냅샷 추가
  const config = await loadConfig(rootDir);
  if (config) {
    const lockfile = await readLockfile(rootDir);
    snapshot.configSnapshot = {
      lockfile: lockfile ?? generateLockfile(config, { includeSnapshot: true }),
      configHash: computeConfigHash(config),
    };
  }

  // 저장...
}

export async function rollbackChange(
  rootDir: string,
  options?: RollbackOptions
): Promise<boolean> {
  const snapshot = await readSnapshot(rootDir, snapshotId);

  // 기존 복원
  await restoreSnapshot(rootDir, snapshot);

  // 설정도 복원
  if (snapshot.configSnapshot) {
    await writeLockfile(rootDir, snapshot.configSnapshot.lockfile);
    console.log("✅ Config lockfile restored");
  }

  return true;
}
```

### 4.3 롤백 시 설정 복원

```bash
# 변경 시작
mandu change begin --message "Add new API endpoint"

# 작업 수행 (설정도 변경됨)
# ... AI가 mandu.config 수정 ...

# 문제 발생! 롤백
mandu change rollback

# 출력:
# ✅ Files restored (12 files)
# ✅ Routes manifest restored
# ✅ Config lockfile restored (hash: a1b2c3d4)
```

---

## 5. Brain 연동

### 5.1 개념: Lockfile 불일치 원인 분석

Brain이 Guard 위반을 분석하듯, Lockfile 불일치도 분석합니다.

```typescript
// 현재 Brain
brain.analyze(violations: Violation[])  // 아키텍처 위반만

// 통합 후
brain.analyze(violations: Violation[], configIssues?: ConfigIssue[])
brain.analyzeConfigMismatch(diff: ConfigDiff)  // 설정 불일치 분석
```

### 5.2 구현 방안

```typescript
// packages/core/src/brain/doctor/config-analyzer.ts (신규)

import { ConfigDiff, formatConfigDiff } from "../../utils/differ";

export interface ConfigMismatchAnalysis {
  category: "security" | "mcp" | "general";
  severity: "low" | "medium" | "high" | "critical";
  rootCause: string;
  suggestions: string[];
  autoFixable: boolean;
}

/**
 * 설정 불일치 원인 분석
 */
export function analyzeConfigMismatch(
  diff: ConfigDiff
): ConfigMismatchAnalysis[] {
  const analyses: ConfigMismatchAnalysis[] = [];

  // MCP 서버 변경 감지
  if (diff.modified.some(m => m.path.startsWith("mcpServers"))) {
    analyses.push({
      category: "mcp",
      severity: "medium",
      rootCause: "MCP 서버 설정이 변경되었습니다",
      suggestions: [
        "의도한 변경이면: mandu lock 실행",
        "의도하지 않은 변경이면: git checkout mandu.config.ts",
      ],
      autoFixable: false,
    });
  }

  // 민감 필드 변경 감지
  const sensitiveChanges = diff.modified.filter(m =>
    m.path.includes("apiKey") ||
    m.path.includes("secret") ||
    m.path.includes("token")
  );

  if (sensitiveChanges.length > 0) {
    analyses.push({
      category: "security",
      severity: "critical",
      rootCause: "민감 정보가 변경되었습니다",
      suggestions: [
        "환경 변수를 통해 주입하는 것을 권장합니다",
        "민감 정보는 .env 파일에 보관하세요",
      ],
      autoFixable: false,
    });
  }

  return analyses;
}

/**
 * LLM 기반 심층 분석 (선택적)
 */
export async function analyzeConfigMismatchWithLLM(
  diff: ConfigDiff,
  adapter: LLMAdapter
): Promise<ConfigMismatchAnalysis[]> {
  const prompt = buildConfigAnalysisPrompt(diff);
  const response = await adapter.complete(prompt);
  return parseAnalysisResponse(response);
}
```

### 5.3 Doctor 통합

```bash
mandu doctor

# 출력:
# ══════════════════════════════════════════
# 🩺 Mandu Doctor Report
# ══════════════════════════════════════════
#
# Architecture Issues: 2
# ──────────────────────────────────────────
# 1. [HIGH] Cross-layer import in UserService.ts
#    → Suggestion: Move to shared/utils
#
# Config Issues: 1                          ← 신규!
# ──────────────────────────────────────────
# 1. [CRITICAL] Sensitive field modified
#    Path: apiKey
#    → Use environment variable instead
```

---

## 6. DevTools 통합

### 6.1 개념: 실시간 설정 변경 감지

DevTools가 런타임 에러를 캡처하듯, 설정 변경도 실시간으로 감지합니다.

```typescript
// 현재 DevTools 이벤트
type KitchenEvent = ErrorEvent | NetworkEvent | IslandEvent | GuardEvent;

// 통합 후
type KitchenEvent =
  | ErrorEvent
  | NetworkEvent
  | IslandEvent
  | GuardEvent
  | ConfigChangeEvent;  // 신규

interface ConfigChangeEvent extends KitchenEvent {
  type: "config_change";
  timestamp: number;
  data: {
    path: string;
    oldValue: unknown;
    newValue: unknown;
    changeType: "added" | "modified" | "removed";
    isSensitive: boolean;  // 민감 정보 여부
  };
}
```

### 6.2 구현 방안

```typescript
// packages/core/src/devtools/client/config-watcher.ts (신규)

import { diffConfig, type ConfigDiff } from "../../utils/differ";
import { isSensitiveField } from "../../config";

export class ConfigWatcher {
  private lastConfig: Record<string, unknown> | null = null;
  private watcher: FSWatcher | null = null;

  /**
   * 설정 파일 감시 시작
   */
  start(configPath: string): void {
    this.watcher = watch(configPath, async () => {
      const newConfig = await loadConfig(configPath);

      if (this.lastConfig) {
        const diff = diffConfig(this.lastConfig, newConfig);

        if (diff.hasChanges) {
          this.emitChanges(diff);
        }
      }

      this.lastConfig = newConfig;
    });
  }

  /**
   * 변경 이벤트 발행
   */
  private emitChanges(diff: ConfigDiff): void {
    for (const change of diff.modified) {
      const event: ConfigChangeEvent = {
        type: "config_change",
        timestamp: Date.now(),
        data: {
          path: change.path,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changeType: "modified",
          isSensitive: this.isSensitivePath(change.path),
        },
      };

      // DevTools Hook에 전달
      getOrCreateHook().emit(event);
    }
  }
}
```

### 6.3 UI 통합

```typescript
// DevTools 패널에 Config 탭 추가

const ConfigPanel = () => {
  const configEvents = useConfigEvents();

  return (
    <div className="config-panel">
      <h3>Config Changes</h3>

      {configEvents.map(event => (
        <ConfigChangeItem
          key={event.timestamp}
          path={event.data.path}
          changeType={event.data.changeType}
          isSensitive={event.data.isSensitive}
        />
      ))}

      <LockfileStatus />  {/* 현재 lockfile 상태 표시 */}
    </div>
  );
};
```

---

## 7. Init 강화

### 7.1 개념: 프로젝트 생성 시 Lockfile 자동 생성

`mandu init` 시 lockfile을 자동으로 생성합니다.

```bash
# 현재
mandu init my-app
# → mandu.config.ts 생성
# → .mcp.json 생성

# 통합 후
mandu init my-app
# → mandu.config.ts 생성
# → .mcp.json 생성
# → .mandu/lockfile.json 생성 (자동!)
```

### 7.2 구현 방안

```typescript
// packages/cli/src/commands/init.ts 확장

import { generateLockfile, writeLockfile } from "@mandujs/core";

export async function init(options: InitOptions): Promise<boolean> {
  // 기존 로직...

  // 설정 파일 생성 후 lockfile 자동 생성
  const config = await loadConfig(projectDir);
  if (config) {
    const lockfile = generateLockfile(config, {
      includeSnapshot: true,
      includeMcpServerHashes: true,
    });

    await writeLockfile(projectDir, lockfile);
    console.log("✅ Lockfile created (.mandu/lockfile.json)");
  }

  return true;
}
```

### 7.3 템플릿 확장

```typescript
// templates/default/mandu.config.ts

import { defineConfig, mcpServerRef, sensitiveEnvValue } from "@mandujs/core";

export default defineConfig({
  // MCP 서버 (Symbol 메타데이터 사용)
  mcpServers: {
    mandu: mcpServerRef("mandu"),
  },

  // 환경 변수 기반 설정
  api: {
    baseUrl: sensitiveEnvValue("API_BASE_URL"),
  },

  // 보호된 설정
  security: {
    level: protectedField("Security configuration"),
  },
});
```

---

## 8. MCP 서버 상태 추적

### 8.1 개념: Symbol로 MCP 서버 상태 관리

MCP 서버의 연결 상태를 Symbol 메타데이터로 추적합니다.

```typescript
// 이미 구현된 Symbol
export const MCP_SERVER_STATUS = Symbol.for("mandu:mcpServerStatus");

export interface McpServerStatusMetadata {
  status: "unknown" | "connected" | "disconnected" | "error";
  lastCheck?: string;
  error?: string;
}
```

### 8.2 런타임 상태 업데이트

```typescript
// packages/core/src/mcp/status-tracker.ts (신규)

import { withMetadata, MCP_SERVER_STATUS } from "../config";

export class McpStatusTracker {
  private statuses = new Map<string, McpServerStatusMetadata>();

  /**
   * 서버 상태 업데이트
   */
  updateStatus(
    serverName: string,
    status: McpServerStatusMetadata["status"],
    error?: string
  ): void {
    this.statuses.set(serverName, {
      status,
      lastCheck: new Date().toISOString(),
      error,
    });

    // DevTools에 이벤트 발행
    getOrCreateHook().emit({
      type: "mcp_status_change",
      timestamp: Date.now(),
      data: { serverName, status, error },
    });
  }

  /**
   * 서버 상태 조회
   */
  getStatus(serverName: string): McpServerStatusMetadata {
    return this.statuses.get(serverName) ?? { status: "unknown" };
  }

  /**
   * 모든 서버 상태 요약
   */
  getSummary(): McpStatusSummary {
    const servers = Array.from(this.statuses.entries());
    return {
      total: servers.length,
      connected: servers.filter(([_, s]) => s.status === "connected").length,
      disconnected: servers.filter(([_, s]) => s.status === "disconnected").length,
      error: servers.filter(([_, s]) => s.status === "error").length,
    };
  }
}
```

### 8.3 dev 서버 시작 시 검증

```typescript
// packages/cli/src/commands/dev.ts 확장

export async function dev(options?: DevOptions): Promise<void> {
  // Lockfile 검증
  const { result, action } = await validateWithPolicy(config, lockfile);

  if (action === "block") {
    console.error("🛑 서버 시작 차단: Lockfile 불일치");
    console.error("   'mandu lock' 또는 'mandu lock --diff'로 확인하세요.");
    process.exit(1);
  }

  if (action === "warn") {
    console.warn("⚠️  Lockfile 불일치 - 개발 모드에서 계속 진행");
  }

  // MCP 서버 상태 체크
  const mcpStatus = await checkMcpServers(config.mcpServers);
  for (const [name, status] of Object.entries(mcpStatus)) {
    if (status.status === "error") {
      console.warn(`⚠️  MCP 서버 '${name}' 연결 실패: ${status.error}`);
    }
  }

  // 서버 시작...
}
```

---

## 9. 구현 우선순위

### Phase 1: 핵심 통합 (1-2주)

| 우선순위 | 기능 | 난이도 | 영향도 |
|---------|------|-------|--------|
| 1 | Init + Lockfile 자동 생성 | 낮음 | 높음 |
| 2 | dev 서버 시작 시 검증 | 낮음 | 높음 |
| 3 | check 명령 통합 | 중간 | 높음 |

### Phase 2: Guard/Brain 연동 (2-3주)

| 우선순위 | 기능 | 난이도 | 영향도 |
|---------|------|-------|--------|
| 4 | Guard + Config Guard 통합 | 중간 | 중간 |
| 5 | Brain Config 분석 | 중간 | 중간 |
| 6 | Doctor 리포트 통합 | 낮음 | 중간 |

### Phase 3: 고급 기능 (3-4주)

| 우선순위 | 기능 | 난이도 | 영향도 |
|---------|------|-------|--------|
| 7 | Contract 보호 필드 | 높음 | 중간 |
| 8 | Change 트랜잭션 연동 | 중간 | 중간 |
| 9 | DevTools Config 패널 | 높음 | 낮음 |
| 10 | MCP 상태 추적 | 중간 | 낮음 |

---

## 10. 예상 효과

### 10.1 개발자 경험

```bash
# Before: 설정 변경이 눈에 안 보임
AI가 mandu.config 수정 → 배포 → 프로덕션 장애 😱

# After: 모든 단계에서 검증
mandu init           # lockfile 자동 생성
mandu dev            # 시작 시 검증
mandu build          # 빌드 시 검증 (CI에서 실패)
mandu lock --verify  # 수동 검증
mandu doctor         # 원인 분석
```

### 10.2 AI-Human 협업

```
┌─────────────────────────────────────────────────────────┐
│                    AI 역할                              │
│  ✅ 구현 코드 자유롭게 수정                             │
│  ✅ 테스트 코드 자유롭게 수정                           │
│  ⚠️  설정 변경 시 경고                                  │
│  ❌ 보호된 필드 수정 불가                               │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Human 역할                            │
│  ✅ 설정 변경 승인 (mandu lock)                         │
│  ✅ 보호된 필드 수정                                    │
│  ✅ 프로덕션 배포 결정                                  │
└─────────────────────────────────────────────────────────┘
```

### 10.3 ont-run 철학 실현

> **"Vibe code with confidence"**
>
> AI는 구현에 집중하고, Human은 API 계약과 설정을 승인합니다.
> Lockfile은 이 경계를 명확히 하고, 의도치 않은 변경을 감지합니다.

---

## 관련 문서

- [ont-run 도입 계획](./08_ont-run_adoption_plan.md)
- [Lockfile 사용 가이드](../guides/lockfile.md)
- [Guard 가이드](../guides/guard.md)
- [Contract 가이드](../guides/contract.md)
