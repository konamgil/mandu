# ont-run 기법 도입 계획서

> **문서 ID**: MANDU-ONT-RUN-ADOPTION
> **버전**: 1.0
> **작성일**: 2026-02-04
> **대상**: mandu 코어/플랫폼 팀
> **참조**: `DNA/ont-run/`, `docs/plans/06_mandu_dna_master_plan.md`

---

## 1. 배경과 목적

### 1.1 ont-run 소개

**ont-run**은 AI 코딩 에이전트(Claude, Cursor 등)를 위해 설계된 **온톨로지 중심의 웹 프레임워크**로, 핵심 철학은 다음과 같다:

> **"Vibe code with confidence"** - 작성 권한과 검토 권한을 분리하여, AI는 구현(resolver)을 자유롭게 수정하고, 인간만이 API 계약(ontology)을 승인한다.

### 1.2 도입 목적

mandu는 **Agent-Native Fullstack Framework**로서 AI 에이전트와의 협업을 핵심 가치로 한다. ont-run에서 발견된 다음 기법들을 도입하여 mandu의 **설정 무결성, 변경 감지, AI-Human 협업 워크플로우**를 강화한다:

1. **결정론적 해싱** - 설정 파일 변경 감지 및 무결성 검증
2. **Symbol 기반 메타데이터** - Zod 스키마 확장 패턴
3. **Diff 시스템** - 설정 변경 시각화
4. **Lockfile 패턴** - 설정 버전 관리 및 팀 협업 지원
5. **이중 계층 분리** - AI 수정 가능 영역 명확화

---

## 2. ont-run 핵심 분석

### 2.1 이중 계층 아키텍처

| 계층 | 내용 | 수정 권한 | 검토 필요 |
|------|------|----------|----------|
| **Ontology** | API 정의, 접근 그룹, 입출력 스키마, 설명 | 인간만 | ✅ Yes |
| **Implementation** | Resolver 코드, 환경 설정, 인증 로직 | AI 자유롭게 | ❌ No |

### 2.2 핵심 파일 분석

| 파일 | 책임 | mandu 적용 가능성 |
|------|------|------------------|
| `src/lockfile/hasher.ts` | 결정론적 해싱, 스냅샷 추출 | 🔴 즉시 도입 |
| `src/lockfile/differ.ts` | 온톨로지 비교 및 diff 생성 | 🔴 즉시 도입 |
| `src/config/categorical.ts` | Symbol 기반 메타데이터 | 🟡 중기 도입 |
| `src/cli/commands/review.ts` | 검토 UI 워크플로우 | 🟢 장기 연구 |
| `src/sdk/generator.ts` | TypeScript/React 코드 생성 | 🟡 중기 도입 |

### 2.3 기술 스택 비교

| 영역 | ont-run | mandu 현재 | 도입 여부 |
|------|---------|-----------|----------|
| API 프레임워크 | Hono | - | 참고 |
| CLI | Citty | Commander | 유지 |
| 번들러 | tsup | tsup | ✅ 동일 |
| 검증 | Zod 4+ | Zod | ✅ 동일 |
| 해싱 | crypto (SHA256) | - | 🔴 도입 |

---

## 3. 도입 기법 상세

### 3.0 적용 범위 (스코프)

**대상 구분**:
- **프로젝트 설정**: `mandu.config.ts` (또는 `.json`)  
  → 해싱/lockfile/검증의 1차 대상
- **MCP 설정**: `.mcp.json`  
  → 별도 해시/검증 대상으로 분리 (보안/환경 분리 목적)

**원칙**:
- 서로 다른 설정 파일은 **서로 다른 해시**로 추적
- Diff 출력 시 **민감 정보(redact) 기본 적용**

### 3.1 결정론적 해싱 (Deterministic Hashing)

#### 3.1.1 개념

객체의 키 순서에 관계없이 동일한 해시값을 생성하는 기법. `{a:1, b:2}`와 `{b:2, a:1}`이 같은 해시를 갖게 된다.

#### 3.1.2 ont-run 구현

```typescript
// DNA/ont-run/src/lockfile/hasher.ts
function computeHash(data: unknown): string {
  const normalized = JSON.stringify(data, (_, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {} as Record<string, unknown>);
    }
    return value;
  });

  return createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 16);
}
```

#### 3.1.3 mandu 적용 방안

**적용 대상**:
- `mandu.config.json` / `mandu.config.ts` 무결성 검증
- MCP 서버 설정 변경 감지
- 프로젝트 초기화 설정 버전 관리

**구현 위치**: `packages/core/src/utils/hasher.ts`

**인터페이스 설계**:
```typescript
export interface HashOptions {
  algorithm?: 'sha256';
  length?: number;        // 해시 길이 (기본값: 16)
  exclude?: string[];     // 해시에서 제외할 키
}

export function computeConfigHash(
  config: ManduConfig,
  options?: HashOptions
): string;

export function verifyConfigIntegrity(
  config: ManduConfig,
  expectedHash: string
): boolean;
```

**정규화 규칙 (필수 명시)**:
- 해싱은 `validateAndReport`로 로드된 **정규화된 config 객체**에 대해 수행
- 함수/Date/BigInt/Map/Set 등 비직렬화 요소는 제거 또는 문자열 대체 규칙 정의
- `undefined`는 키 제거로 정규화 (JSON.stringify와 동일)

---

### 3.2 Symbol 기반 메타데이터 패턴

#### 3.2.1 개념

Zod 스키마 객체에 Symbol을 키로 사용하여 메타데이터를 부착하는 기법. 타입 안전성을 유지하면서 런타임 정보를 보존한다.

#### 3.2.2 ont-run 구현

```typescript
// DNA/ont-run/src/config/categorical.ts
const FIELD_FROM_METADATA = Symbol.for("ont:fieldFrom");

export function fieldFrom(functionName: string): FieldFromString {
  const schema = z.string() as FieldFromString;
  schema[FIELD_FROM_METADATA] = { functionName };
  return schema;
}

// 메타데이터 조회
export function getFieldFromMetadata(schema: z.ZodType): FieldFromMetadata | undefined {
  return (schema as any)[FIELD_FROM_METADATA];
}
```

#### 3.2.3 mandu 적용 방안

**적용 대상**:
- MCP 서버 설정에 상태 정보 부착
- 검증 규칙에 커스텀 메타데이터 추가
- 스키마 간 참조 관계 표현

**구현 위치**: `packages/core/src/config/metadata.ts`

**인터페이스 설계**:
```typescript
// Symbol 정의
export const MCP_SERVER_STATUS = Symbol.for("mandu:mcpServerStatus");
export const VALIDATION_CONTEXT = Symbol.for("mandu:validationContext");
export const SCHEMA_REFERENCE = Symbol.for("mandu:schemaReference");

// 메타데이터 부착 유틸리티
export function withMetadata<T extends z.ZodType>(
  schema: T,
  key: symbol,
  value: unknown
): T;

// 메타데이터 조회 유틸리티
export function getMetadata<T>(
  schema: z.ZodType,
  key: symbol
): T | undefined;

// 사용 예시
export function mcpServerRef(serverName: string): z.ZodString {
  return withMetadata(z.string(), SCHEMA_REFERENCE, {
    type: 'mcpServer',
    name: serverName
  });
}
```

---

### 3.3 Diff 시스템

#### 3.3.1 개념

두 설정 객체를 비교하여 추가/삭제/수정된 항목을 구조화된 형태로 반환하고, 콘솔에 시각화하는 시스템.

#### 3.3.2 ont-run 구현

```typescript
// DNA/ont-run/src/lockfile/differ.ts
export interface OntologyDiff {
  hasChanges: boolean;
  addedGroups: string[];
  removedGroups: string[];
  addedEntities: string[];
  removedEntities: string[];
  functions: FunctionDiff[];
}

export interface FunctionDiff {
  name: string;
  type: 'added' | 'removed' | 'modified';
  changes?: {
    description?: { old: string; new: string };
    access?: { added: string[]; removed: string[] };
    inputs?: { old: string; new: string };
    outputs?: { old: string; new: string };
  };
}

export function diffOntology(
  oldOntology: OntologySnapshot,
  newOntology: OntologySnapshot
): OntologyDiff;

export function formatDiff(diff: OntologyDiff): string;
```

#### 3.3.3 mandu 적용 방안

**적용 대상**:
- `mandu init` 시 기존 설정과 새 설정 비교
- `mandu upgrade` 시 버전 간 변경사항 표시
- MCP 서버 설정 변경 시 영향 범위 시각화

**구현 위치**: `packages/core/src/utils/differ.ts`

**인터페이스 설계**:
```typescript
export interface ConfigDiff {
  hasChanges: boolean;
  timestamp: string;

  // MCP 서버 변경
  mcpServers: {
    added: string[];
    removed: string[];
    modified: Array<{
      name: string;
      changes: Record<string, { old: unknown; new: unknown }>;
    }>;
  };

  // 프로젝트 설정 변경
  projectConfig: {
    added: string[];
    removed: string[];
    modified: Array<{
      key: string;
      old: unknown;
      new: unknown;
    }>;
  };
}

export function diffConfig(
  oldConfig: ManduConfig,
  newConfig: ManduConfig
): ConfigDiff;

export function formatConfigDiff(
  diff: ConfigDiff,
  options?: {
    color?: boolean;
    verbose?: boolean;
    redactKeys?: string[];   // 기본값: ["token","secret","key","password","authorization","cookie"]
    showSecrets?: boolean;   // true면 redact 해제
  }
): string;

export function printConfigDiff(diff: ConfigDiff): void;
```

**보안 기본값**:
- Diff 출력은 기본적으로 민감 키를 마스킹(redact)
- `--show-secrets` 옵션에서만 원문 출력 허용

**콘솔 출력 예시**:
```
╭─────────────────────────────────────────────────╮
│  mandu.config.json 변경 감지                      │
├─────────────────────────────────────────────────┤
│                                                 │
│  MCP 서버:                                       │
│    + sequential-thinking (추가됨)                │
│    ~ context7 (수정됨)                           │
│      - url: "old-url" → "new-url"               │
│    - magic (삭제됨)                              │
│                                                 │
│  프로젝트 설정:                                   │
│    ~ port: 3000 → 3001                          │
│                                                 │
╰─────────────────────────────────────────────────╯
```

---

### 3.4 Lockfile 패턴

#### 3.4.1 개념

승인된 설정의 해시를 별도 파일(`*.lock`)에 저장하여, 런타임에 현재 설정과 비교해 무단 변경을 감지하는 패턴.

#### 3.4.2 ont-run 구현

```typescript
// DNA/ont-run/src/lockfile/types.ts
export interface LockfileData {
  version: string;
  hash: string;
  timestamp: string;
  snapshot: OntologySnapshot;
}

// DNA/ont-run/src/lockfile/index.ts
export async function readLockfile(path: string): Promise<LockfileData | null>;
export async function writeLockfile(path: string, data: LockfileData): Promise<void>;
export function validateAgainstLockfile(
  current: OntologySnapshot,
  lockfile: LockfileData
): { valid: boolean; diff?: OntologyDiff };
```

**ont-run 동작 방식**:
- 개발 모드: lockfile 불일치 시 경고 + 검토 UI 표시
- 프로덕션 모드: lockfile 불일치 시 서버 시작 차단

#### 3.4.3 mandu 적용 방안

**적용 대상**:
- `.mandu/lockfile.json` 파일로 설정 버전 관리
- 팀 협업 시 설정 충돌 방지
- CI/CD에서 설정 무결성 검증
- `.mcp.json` 변경 감지 및 검증 (선택)

**구현 위치**: `packages/core/src/lockfile/`

**인터페이스 설계**:
```typescript
// packages/core/src/lockfile/types.ts
export interface ManduLockfile {
  schemaVersion: 1;          // lockfile 스키마 버전
  manduVersion: string;      // mandu 버전
  configHash: string;        // mandu.config 해시
  mcpConfigHash?: string;    // .mcp.json 해시 (선택)
  generatedAt: string;       // ISO timestamp

  // MCP 서버별 해시
  mcpServers?: Record<string, {
    hash: string;
    version?: string;
  }>;

  // 스냅샷 (선택적)
  snapshot?: {
    config: ManduConfig;
    environment: string;
  };
}

// packages/core/src/lockfile/index.ts
export const LOCKFILE_NAME = '.mandu/lockfile.json';

export async function readLockfile(
  projectRoot: string
): Promise<ManduLockfile | null>;

export async function writeLockfile(
  projectRoot: string,
  lockfile: ManduLockfile
): Promise<void>;

export async function generateLockfile(
  config: ManduConfig,
  mcpConfig?: Record<string, unknown>
): Promise<ManduLockfile>;

export function validateLockfile(
  config: ManduConfig,
  lockfile: ManduLockfile
): LockfileValidationResult;

export interface LockfileValidationResult {
  valid: boolean;
  errors: LockfileError[];
  warnings: LockfileWarning[];
  diff?: ConfigDiff;
}
```

**CLI 통합**:
```bash
# lockfile 생성/갱신
mandu lock

# lockfile 검증
mandu lock --verify

# lockfile과 현재 설정 비교
mandu lock --diff

# 민감정보 출력 허용 (기본은 redact)
mandu lock --diff --show-secrets
```

**동작 정책 (제안)**:
- dev: 불일치 시 경고만
- build/ci: 불일치 시 실패 (옵션으로 완화)
- prod: 불일치 시 서버 시작 차단  
  → 긴급 우회: `MANDU_LOCK_BYPASS=1`

---

### 3.5 이중 계층 분리 (AI 권한 제한)

#### 3.5.1 개념

코드베이스를 "AI가 수정 가능한 영역"과 "인간만 수정 가능한 영역"으로 명확히 분리하여, AI 에이전트와의 안전한 협업을 보장.

#### 3.5.2 ont-run의 분리 기준

| 카테고리 | AI 수정 가능 | 인간 검토 필요 |
|----------|-------------|---------------|
| Resolver 구현 | ✅ | ❌ |
| 환경 설정 | ✅ | ❌ |
| API 함수 정의 | ❌ | ✅ |
| 접근 그룹 | ❌ | ✅ |
| 입출력 스키마 | ❌ | ✅ |

#### 3.5.3 mandu 적용 방안

**mandu의 분리 기준 제안**:

| 카테고리 | AI 수정 가능 | 인간 검토 필요 |
|----------|-------------|---------------|
| 컴포넌트 구현 | ✅ | ❌ |
| API 핸들러 로직 | ✅ | ❌ |
| 스타일/CSS | ✅ | ❌ |
| `mandu.config.ts` | ❌ | ✅ |
| MCP 서버 설정 | ❌ | ✅ |
| 환경 변수 정의 | ❌ | ✅ |
| 보안 관련 설정 | ❌ | ✅ |

**구현 방안**:

1. **파일 레벨 마킹**:
```typescript
// mandu.config.ts 상단에 추가
/**
 * @mandu-protected
 * 이 파일은 AI 에이전트가 직접 수정하면 안 됩니다.
 * 변경 시 'mandu lock' 명령으로 승인이 필요합니다.
 */
```

2. **Architecture Guard 규칙 추가**:
- `@mandu-protected` 파일 변경 감지
- dev: 경고, ci/prod: 실패 (옵션으로 완화)

3. **런타임 검증**:
```typescript
// 서버 시작 시
if (process.env.NODE_ENV === 'production') {
  const validation = validateLockfile(config, lockfile);
  if (!validation.valid) {
    console.error('❌ 설정이 승인되지 않은 상태입니다.');
    console.error('   mandu lock 명령을 실행하여 변경사항을 승인하세요.');
    process.exit(1);
  }
}
```

4. **AI 에이전트 감지 (선택적)**:
```typescript
// ont-run 방식 참고
function detectCodingAgent(): boolean {
  // 환경 변수, 프로세스 이름 등으로 감지
  const agentIndicators = [
    process.env.CLAUDE_CODE,
    process.env.CURSOR_AI,
    process.env.GITHUB_COPILOT,
  ];
  return agentIndicators.some(Boolean);
}
```

---

## 4. 구현 계획

### 4.1 Phase 1: 핵심 유틸리티 (1주)

**기간**: 2026-02-05 ~ 2026-02-11

**작업 목록**:

| ID | 작업 | 산출물 | 우선순위 |
|----|------|--------|---------|
| P1-1 | 결정론적 해싱 구현 | `packages/core/src/utils/hasher.ts` | P0 |
| P1-2 | Diff 시스템 구현 | `packages/core/src/utils/differ.ts` | P0 |
| P1-3 | 해싱 단위 테스트 | `tests/utils/hasher.test.ts` | P0 |
| P1-4 | Diff 단위 테스트 | `tests/utils/differ.test.ts` | P0 |
| P1-5 | Diff 출력 redaction 옵션 | `packages/core/src/utils/differ.ts` | P1 |
| P1-6 | Config 정규화 규칙 구현 | `packages/core/src/utils/hasher.ts` | P1 |

**산출물 상세**:

```
packages/core/src/utils/
├── hasher.ts           # 결정론적 해싱
├── differ.ts           # 설정 비교 및 diff 생성
└── index.ts            # 공개 API

tests/utils/
├── hasher.test.ts
└── differ.test.ts
```

---

### 4.2 Phase 2: Lockfile 시스템 (1주)

**기간**: 2026-02-12 ~ 2026-02-18

**작업 목록**:

| ID | 작업 | 산출물 | 우선순위 |
|----|------|--------|---------|
| P2-1 | Lockfile 타입 정의 | `packages/core/src/lockfile/types.ts` | P0 |
| P2-2 | Lockfile I/O 구현 | `packages/core/src/lockfile/index.ts` | P0 |
| P2-3 | Lockfile 검증 로직 | `packages/core/src/lockfile/validate.ts` | P0 |
| P2-4 | CLI 명령 추가 | `packages/cli/src/commands/lock.ts` | P1 |
| P2-5 | Lockfile 통합 테스트 | `tests/lockfile/` | P0 |
| P2-6 | Lockfile 우회/환경 옵션 정의 | `packages/core/src/lockfile/validate.ts` | P2 |

**산출물 상세**:

```
packages/core/src/lockfile/
├── types.ts            # 타입 정의
├── index.ts            # 읽기/쓰기
├── validate.ts         # 검증 로직
└── generate.ts         # lockfile 생성

packages/cli/src/commands/
└── lock.ts             # mandu lock 명령

tests/lockfile/
├── generate.test.ts
├── validate.test.ts
└── integration.test.ts
```

---

### 4.3 Phase 3: Symbol 메타데이터 패턴 (1주)

**기간**: 2026-02-19 ~ 2026-02-25

**작업 목록**:

| ID | 작업 | 산출물 | 우선순위 |
|----|------|--------|---------|
| P3-1 | 메타데이터 유틸리티 | `packages/core/src/config/metadata.ts` | P1 |
| P3-2 | MCP 서버 참조 기능 | `packages/core/src/config/mcp-ref.ts` | P1 |
| P3-3 | 메타데이터 테스트 | `tests/config/metadata.test.ts` | P1 |
| P3-4 | 기존 스키마 통합 | 기존 파일 수정 | P2 |

**산출물 상세**:

```
packages/core/src/config/
├── metadata.ts         # Symbol 메타데이터 유틸리티
├── mcp-ref.ts          # MCP 서버 참조 헬퍼
└── symbols.ts          # Symbol 상수 정의

tests/config/
└── metadata.test.ts
```

---

### 4.4 Phase 4: 통합 및 문서화 (1주)

**기간**: 2026-02-26 ~ 2026-03-04

**작업 목록**:

| ID | 작업 | 산출물 | 우선순위 |
|----|------|--------|---------|
| P4-1 | init 명령 통합 | 기존 파일 수정 | P0 |
| P4-2 | 서버 시작 시 검증 | 기존 파일 수정 | P1 |
| P4-3 | 사용자 가이드 | `docs/guides/lockfile.md` | P1 |
| P4-4 | API 문서 업데이트 | `docs/api/` | P2 |
| P4-5 | E2E 테스트 | `tests/e2e/lockfile.test.ts` | P1 |
| P4-6 | @mandu-protected Guard 규칙 | `packages/core/src/guard/` | P1 |

---

## 5. 파일 구조 (최종)

```
packages/core/src/
├── utils/
│   ├── hasher.ts           # 🆕 결정론적 해싱
│   ├── differ.ts           # 🆕 설정 비교
│   └── index.ts
├── lockfile/
│   ├── types.ts            # 🆕 Lockfile 타입
│   ├── index.ts            # 🆕 읽기/쓰기
│   ├── validate.ts         # 🆕 검증 로직
│   └── generate.ts         # 🆕 생성 로직
├── config/
│   ├── metadata.ts         # 🆕 Symbol 메타데이터
│   ├── mcp-ref.ts          # 🆕 MCP 서버 참조
│   ├── symbols.ts          # 🆕 Symbol 상수
│   └── ... (기존 파일)
└── ... (기존 구조)

packages/cli/src/commands/
├── lock.ts                 # 🆕 mandu lock 명령
└── ... (기존 파일)

tests/
├── utils/
│   ├── hasher.test.ts      # 🆕
│   └── differ.test.ts      # 🆕
├── lockfile/
│   ├── generate.test.ts    # 🆕
│   ├── validate.test.ts    # 🆕
│   └── integration.test.ts # 🆕
├── config/
│   └── metadata.test.ts    # 🆕
└── e2e/
    └── lockfile.test.ts    # 🆕

docs/
├── guides/
│   └── lockfile.md         # 🆕 Lockfile 가이드
└── ... (기존 문서)
```

---

## 6. 의존성

### 6.1 새로운 의존성

| 패키지 | 버전 | 용도 | 필수 여부 |
|--------|------|------|----------|
| `node:crypto` | 내장 | SHA256 해싱 | 필수 (추가 설치 불필요) |

### 6.2 기존 의존성 활용

| 패키지 | 용도 |
|--------|------|
| `zod` | 스키마 정의, 메타데이터 부착 대상 |
| `consola` | 로깅, diff 출력 |
| `picocolors` | 콘솔 색상화 |

---

## 7. 테스트 전략

### 7.1 단위 테스트

```typescript
// tests/utils/hasher.test.ts
describe('computeConfigHash', () => {
  it('should produce same hash regardless of key order', () => {
    const config1 = { a: 1, b: 2 };
    const config2 = { b: 2, a: 1 };
    expect(computeConfigHash(config1)).toBe(computeConfigHash(config2));
  });

  it('should produce different hash for different values', () => {
    const config1 = { a: 1 };
    const config2 = { a: 2 };
    expect(computeConfigHash(config1)).not.toBe(computeConfigHash(config2));
  });

  it('should handle nested objects', () => {
    const config = { a: { b: { c: 1 } } };
    expect(() => computeConfigHash(config)).not.toThrow();
  });
});

// tests/utils/differ.test.ts
describe('diffConfig', () => {
  it('should detect added MCP servers', () => {
    const oldConfig = { mcpServers: {} };
    const newConfig = { mcpServers: { sequential: { url: '...' } } };
    const diff = diffConfig(oldConfig, newConfig);
    expect(diff.mcpServers.added).toContain('sequential');
  });

  it('should detect modified values', () => {
    const oldConfig = { port: 3000 };
    const newConfig = { port: 3001 };
    const diff = diffConfig(oldConfig, newConfig);
    expect(diff.projectConfig.modified[0]).toMatchObject({
      key: 'port',
      old: 3000,
      new: 3001,
    });
  });

  it('should redact secrets by default in formatted diff', () => {
    const oldConfig = { mcpServers: { mandu: { token: 'old' } } };
    const newConfig = { mcpServers: { mandu: { token: 'new' } } };
    const diff = diffConfig(oldConfig, newConfig);
    const text = formatConfigDiff(diff);
    expect(text).toContain('***');
    expect(text).not.toContain('new');
  });
});
```

### 7.2 통합 테스트

```typescript
// tests/lockfile/integration.test.ts
describe('Lockfile Integration', () => {
  it('should generate and validate lockfile', async () => {
    const config = await loadConfig('test-project');
    const lockfile = await generateLockfile(config);
    await writeLockfile('test-project', lockfile);

    const result = validateLockfile(config, lockfile);
    expect(result.valid).toBe(true);
  });

  it('should detect config changes', async () => {
    const lockfile = await readLockfile('test-project');
    const modifiedConfig = { ...originalConfig, port: 9999 };

    const result = validateLockfile(modifiedConfig, lockfile);
    expect(result.valid).toBe(false);
    expect(result.diff.hasChanges).toBe(true);
  });
});
```

### 7.3 E2E 테스트

```typescript
// tests/e2e/lockfile.test.ts
describe('mandu lock CLI', () => {
  it('should create lockfile', async () => {
    await runCLI('mandu lock');
    expect(fileExists('.mandu/lockfile.json')).toBe(true);
  });

  it('should verify lockfile', async () => {
    const result = await runCLI('mandu lock --verify');
    expect(result.exitCode).toBe(0);
  });

  it('should show diff on changes', async () => {
    await modifyConfig();
    const result = await runCLI('mandu lock --diff');
    expect(result.stdout).toContain('변경 감지');
  });
});
```

---

## 8. 리스크 및 대응

| 리스크 | 영향 | 가능성 | 대응 |
|--------|------|--------|------|
| 해싱 충돌 | 낮음 | 매우 낮음 | SHA256의 충돌 가능성은 무시 가능 |
| lockfile 충돌 (팀 협업) | 중간 | 중간 | Git merge driver 제공, 수동 해결 가이드 |
| 성능 영향 (대용량 설정) | 낮음 | 낮음 | 캐싱, 증분 해싱 도입 |
| 기존 프로젝트 마이그레이션 | 중간 | 높음 | `mandu migrate` 명령 제공, 자동 lockfile 생성 |
| 비직렬화 설정 요소 | 중간 | 중간 | 정규화 규칙 명시 + 검증 단계에서 제거 |
| diff 출력의 민감정보 노출 | 중간 | 중간 | 기본 redact + `--show-secrets`에서만 출력 |

---

## 9. 성공 지표 (KPI)

| 영역 | 지표 | 목표값 | 측정 방법 |
|------|------|--------|----------|
| 무결성 | 설정 변경 감지율 | 100% | 자동화 테스트 |
| 성능 | 해싱 시간 | < 10ms | 벤치마크 |
| 사용성 | lockfile 도입률 | 80% (신규 프로젝트) | opt-in 익명 통계 또는 설문 |
| 안정성 | lockfile 관련 버그 | 0건/월 | Issue 트래킹 |

---

## 10. 향후 확장 계획

### 10.1 Phase 5+ (장기)

1. **Review UI**: 브라우저 기반 설정 변경 검토 UI
2. **자동 승인 규칙**: 특정 변경 유형에 대한 자동 승인
3. **CI/CD 통합**: GitHub Actions 등에서 lockfile 검증
4. **원격 lockfile**: 팀 공유를 위한 원격 저장소 지원

### 10.2 SDK 생성기 (참고)

ont-run의 SDK 생성기 패턴을 참고하여, mandu에서도 설정 기반 타입 자동 생성을 검토:

```typescript
// 향후 구현 예시
mandu generate-types --out src/generated/config.d.ts
```

---

## 11. 참고 자료

### 11.1 ont-run 핵심 파일

| 파일 | 경로 |
|------|------|
| 해싱 로직 | `DNA/ont-run/src/lockfile/hasher.ts` |
| Diff 로직 | `DNA/ont-run/src/lockfile/differ.ts` |
| 메타데이터 패턴 | `DNA/ont-run/src/config/categorical.ts` |
| Lockfile 타입 | `DNA/ont-run/src/lockfile/types.ts` |
| 검토 CLI | `DNA/ont-run/src/cli/commands/review.ts` |

### 11.2 관련 문서

- `docs/plans/06_mandu_dna_master_plan.md` - DNA 통합 마스터 계획
- `docs/architecture/02_mandu_technical_architecture.md` - 기술 아키텍처
- `docs/guides/01_configuration.md` - 설정 가이드

---

## 12. 실행 체크리스트

### Phase 1
- [ ] `packages/core/src/utils/hasher.ts` 구현
- [ ] `packages/core/src/utils/differ.ts` 구현
- [ ] `tests/utils/hasher.test.ts` 작성
- [ ] `tests/utils/differ.test.ts` 작성
- [ ] 코드 리뷰 및 머지

### Phase 2
- [ ] `packages/core/src/lockfile/` 디렉토리 생성
- [ ] Lockfile 타입 정의
- [ ] Lockfile I/O 구현
- [ ] Lockfile 검증 로직 구현
- [ ] `mandu lock` CLI 명령 추가
- [ ] 통합 테스트 작성
- [ ] 코드 리뷰 및 머지

### Phase 3
- [ ] Symbol 메타데이터 유틸리티 구현
- [ ] MCP 서버 참조 헬퍼 구현
- [ ] 단위 테스트 작성
- [ ] 기존 스키마와 통합
- [ ] 코드 리뷰 및 머지

### Phase 4
- [ ] `mandu init` 명령에 lockfile 생성 통합
- [ ] 서버 시작 시 lockfile 검증 추가
- [ ] 사용자 가이드 작성
- [ ] API 문서 업데이트
- [ ] E2E 테스트 작성
- [ ] 최종 리뷰 및 릴리스

---

> **다음 리뷰**: 2026-02-11 (Phase 1 완료 후)
> **담당자**: TBD
> **승인자**: TBD
