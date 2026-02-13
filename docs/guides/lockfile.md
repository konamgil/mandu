# Mandu Lockfile 가이드

> 설정 무결성 검증으로 AI-Human 협업의 안전성을 보장합니다.

## 개요

Mandu Lockfile은 `mandu.config`의 **결정론적 해시**를 저장하여 설정 변경을 추적합니다. 이를 통해:

- **의도치 않은 변경 감지**: AI나 다른 도구가 설정을 수정했을 때 즉시 알림
- **환경별 정책 적용**: 개발/빌드/CI/프로덕션 환경마다 다른 검증 수준
- **안전한 협업**: Human이 승인한 설정만 배포 가능

## 빠른 시작

```bash
# 프로젝트 로컬 CLI로 실행(권장)
bunx @mandujs/cli lock

# 설정 무결성 검증
bunx @mandujs/cli lock --verify

# 변경사항 확인
bunx @mandujs/cli lock --diff
```

> 로컬에 구버전 `mandu` 바이너리가 설치된 경우, `bunx @mandujs/cli ...`로 실행해 버전 불일치를 피하세요.

## 작동 원리

### 1. 결정론적 해싱

```typescript
// 키 정렬 후 해싱 → 동일한 값이면 항상 동일한 해시
const hash = computeConfigHash(config);
// {a:1, b:2} 와 {b:2, a:1}은 같은 해시를 생성
```

### 2. Lockfile 구조

`.mandu/lockfile.json`:
```json
{
  "schemaVersion": 1,
  "manduVersion": "0.10.x",
  "configHash": "a1b2c3d4e5f67890",
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "mcpServers": {
    "sequential-thinking": {
      "hash": "f0e9d8c7b6a54321",
      "version": "1.2.0"
    }
  }
}
```

### 3. 환경별 정책

| 환경 | 불일치 시 | 누락 시 | 우회 가능 |
|------|----------|---------|----------|
| development | 경고 | 경고 | ✅ |
| build | 에러 | 에러 | ✅ |
| ci | 에러 | 에러 | ❌ |
| production | 차단 | 차단 | ✅ (긴급) |

## CLI 명령어

### `mandu lock`

Lockfile을 생성하거나 갱신합니다.

```bash
# 기본 생성
mandu lock

# 스냅샷 포함 (diff 기능에 필요)
mandu lock --include-snapshot

# JSON 출력
mandu lock --json
```

### `mandu lock --verify`

현재 설정과 lockfile의 일치 여부를 검증합니다.

```bash
# 기본 검증
mandu lock --verify

# 특정 모드로 검증 (예: CI)
mandu lock --verify --mode=ci
```

출력 예시:
```
✅ Lockfile 검증 통과
   모드: development
   해시: a1b2c3d4e5f67890
```

### `mandu lock --diff`

설정 변경사항을 상세히 보여줍니다.

```bash
# 변경사항 확인
mandu lock --diff

# 민감정보 포함 출력
mandu lock --diff --show-secrets
```

출력 예시:
```
╔════════════════════════════════════════╗
║          Configuration Diff            ║
╚════════════════════════════════════════╝

┌──────────────────────────────────────┐
│  server                              │
├──────────────────────────────────────┤
│  - port: 3000                        │
│  + port: 8080                        │
└──────────────────────────────────────┘

요약: 1개 수정됨
```

## 옵션 상세

| 옵션 | 설명 |
|------|------|
| `--verify, -v` | 검증만 수행 |
| `--diff, -d` | 변경사항 표시 |
| `--show-secrets` | 민감정보 출력 허용 |
| `--include-snapshot` | 설정 스냅샷 포함 |
| `--mode=<mode>` | 검증 모드 지정 |

## 워크플로우

### 개발 흐름

```bash
# 1. 설정 변경 후 lockfile 갱신
mandu lock

# 2. Git에 커밋
git add .mandu/lockfile.json mandu.config.ts
git commit -m "chore: update config"
```

### CI/CD 통합

```yaml
# GitHub Actions 예시
jobs:
  validate:
    steps:
      - name: Verify config integrity
        run: mandu lock --verify --mode=ci
```

### 긴급 우회

프로덕션에서 긴급 상황 시:

```bash
# 환경변수로 우회
MANDU_LOCK_BYPASS=1 mandu dev
```

⚠️ **주의**: 우회 사용 시 로그에 기록됩니다. 정상 상황에서는 항상 lockfile을 갱신하세요.

## 민감 정보 처리

### 자동 마스킹

민감 필드는 diff 출력에서 자동으로 마스킹됩니다:

```typescript
// mandu.config.ts
export default defineConfig({
  apiKey: process.env.API_KEY,  // diff에서 *** 로 표시
});
```

### 민감 필드 정의

Schema에서 메타데이터로 민감 필드를 표시할 수 있습니다:

```typescript
import { sensitiveToken, envValue } from "@mandujs/core";

const configSchema = z.object({
  apiKey: sensitiveToken("API key"),
  dbUrl: envValue("DATABASE_URL"),
});
```

## Symbol 메타데이터

Mandu는 Zod 스키마에 Symbol을 사용해 메타데이터를 부착합니다:

```typescript
import {
  mcpServerRef,
  sensitiveToken,
  protectedField
} from "@mandujs/core";

const schema = z.object({
  // MCP 서버 참조
  thinking: mcpServerRef("sequential-thinking"),

  // 민감 토큰 (로그/diff에서 마스킹)
  apiKey: sensitiveToken(),

  // AI 수정 불가 필드
  securityLevel: protectedField("보안 설정"),
});
```

### 사용 가능한 메타데이터

| 헬퍼 | 용도 |
|------|------|
| `mcpServerRef(name)` | MCP 서버 참조 |
| `sensitiveToken()` | 민감 정보 마킹 |
| `envValue(key, default?)` | 환경변수 기반 값 |
| `protectedField(reason)` | AI 수정 불가 |
| `runtimeInjected(schema)` | 런타임 주입 값 |

## 문제 해결

### Lockfile 불일치

```
❌ Lockfile 검증 실패
   🔴 Configuration has changed since lockfile was generated
```

**해결 방법**:
1. `mandu lock --diff`로 변경사항 확인
2. 의도한 변경이면: `mandu lock` 실행
3. 의도하지 않은 변경이면: 설정 원복

### 스냅샷 누락

```
❌ Lockfile에 스냅샷이 없습니다.
```

**해결 방법**:
```bash
mandu lock --include-snapshot
```

### 환경 감지

현재 환경은 자동으로 감지됩니다:

- `CI=true` → ci 모드
- `NODE_ENV=production` → production 모드
- `npm_lifecycle_event=build` → build 모드
- 기본값 → development 모드

## API 레퍼런스

### `computeConfigHash(config, options?)`

```typescript
import { computeConfigHash } from "@mandujs/core";

const hash = computeConfigHash(config, {
  algorithm: "sha256",  // 기본값
  length: 16,           // 해시 길이 (기본: 16)
  exclude: ["_temp"],   // 제외할 키
});
```

### `generateLockfile(config, options?)`

```typescript
import { generateLockfile } from "@mandujs/core";

const lockfile = generateLockfile(config, {
  includeSnapshot: true,
  includeMcpServerHashes: true,
});
```

### `validateLockfile(config, lockfile)`

```typescript
import { validateLockfile } from "@mandujs/core";

const result = validateLockfile(config, lockfile);
if (!result.valid) {
  console.error(result.errors);
}
```

### `diffConfig(before, after, options?)`

```typescript
import { diffConfig, formatConfigDiff } from "@mandujs/core";

const diff = diffConfig(oldConfig, newConfig);
if (diff.hasChanges) {
  console.log(formatConfigDiff(diff, { color: true }));
}
```

## 관련 문서

- [ont-run 도입 계획](../plans/08_ont-run_adoption_plan.md)
- [MCP 서버 설정](./mcp-servers.md)
- [설정 파일 가이드](./configuration.md)
