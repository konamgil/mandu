---
title: "Phase 7.1 R0.2 — Slot (.slot.ts) dispatch 통합 분석"
status: diagnostic
audience: Phase 7.1 team lead
created: 2026-04-18
updated: 2026-04-19
scope: startDevBundler._doBuild slot dispatch integration design
base_commit: b2dfb3f
---

# Phase 7.1 R0.2 — Slot (`.slot.ts`) dispatch 통합 분석

**기반**: Phase 7.0 E 완료 (커밋 `b2dfb3f`) · **범위**: `startDevBundler._doBuild` 통합 설계

---

## 1. 현재 Slot 변경 Flow (CLI 계층)

### 실제 구현 경로

- **File change**: `app/page.slot.ts` 수정
- **Chokidar watcher** (`watchFSRoutes`): `packages/core/src/router/fs-routes.ts:304-380`
  - `spec/slots/` 및 `spec/contracts/` 감시 (라인 334-338)
  - 변경 감지 시 `triggerRescan()` 호출 (라인 342-348)
- **Manifest 재생성** (`generateManifest`): 라인 210-230
  - `resolveAutoLinks()` 호출 → `route.slotModule = "spec/slots/{id}.slot.ts"` 설정 (라인 151-155)
- **CLI 레이어** (`packages/cli/src/commands/dev.ts:729-752`)
  - `onChange` 콜백: `clearDefaultRegistry()` + `registerHandlers(manifest, true)`
  - HMR broadcast: `{ type: "reload" }` (전체 재로드)

### 문제점

- **`_doBuild` 에서는 무시됨**: `startDevBundler._doBuild` (라인 896-1036) 은 다음을 검사:
  - `isInCommonDir(file)` (라인 900)
  - `clientModuleToRoute.get()` (라인 955)
  - `serverModuleSet.has()` (라인 973) — **slot 파일 미등록**
  - 결과: slot 변경은 조용히 떨어짐 (drop) → `[GAP]` 마크 (matrix.spec.ts:105-107)
- **Workaround**: CLI의 `watchFSRoutes` (chokidar 별도 watcher) 가 manifest 재스캔으로 우회하지만, `_doBuild` 내부 경로는 아님

---

## 2. `_doBuild` 통합 시 3 Options 비교

### Option A — 새 `slotModuleSet` 생성 + 별도 dispatch

```typescript
const slotModuleSet = new Set<string>();
for (const route of manifest.routes) {
  if (route.slotModule) {
    slotModuleSet.add(normalizeFsPath(path.resolve(rootDir, route.slotModule)));
  }
}

// _doBuild 내 (라인 973 직후):
if (onSSRChange && slotModuleSet.has(normalizedPath)) {
  console.log(`🔄 Slot file changed: ${path.basename(changedFile)}`);
  onSSRChange(normalizedPath);
  return;
}
```

- **장점**: 명시적, 추적 가능, slot-specific 로직 용이
- **단점**: 보일러플레이트 증가

### Option B — `serverModuleSet` 에 slot 경로도 추가 ⭐ 권장

```typescript
// 라인 417, 423 근처:
if (route.slotModule) {
  serverModuleSet.add(normalizeFsPath(path.resolve(rootDir, route.slotModule)));
}
```

- **장점**: 최소 변경, slot = SSR-side data loader 의미 일치, 기존 `onSSRChange` 경로 재사용
- **단점**: `serverModuleSet` 의미가 다소 확대됨

### Option C — 별도 `_isSlotFile()` 헬퍼 + classifyBatch 확장

```typescript
function isSlotFile(normalizedPath: string): boolean {
  return normalizedPath.endsWith(".slot.ts") || normalizedPath.endsWith(".slot.tsx");
}
```

- **장점**: `classifyBatch` 도 slot 인식 → 매트릭스 36 cell 자동 복구
- **단점**: 확장성 이슈 (컨벤션 의존)

### 권장: Option B

- Slot = page 의 server-side loader (SSR 계층 코드)
- `serverModuleSet` 추가해도 의미 손상 없음
- 기존 `onSSRChange` 경로 재사용 → 일관성 유지
- 변경 최소 (라인 수 기준)

---

## 3. 예상 Diff 범위

### 필수 변경

**`packages/core/src/bundler/dev.ts`**

| 섹션 | 라인 범위 | 변경 내용 |
|------|---------|---------|
| manifest 순회 | 415-426 | `if (route.slotModule)` 체크 → `serverModuleSet.add()` |
| classifyBatch | 603-610 | slot 파일 감지 (선택, `ssr-only` 분류 명시) |

**`packages/core/src/bundler/scenario-matrix.ts`**

- 라인 154: `classifyBehavior` 이미 slot → `"full-reload"` 반환 ✓ (변경 불필요)

**`packages/core/tests/hmr-matrix/matrix.spec.ts`**

- 라인 105-107: `KNOWN_BUNDLER_GAPS` 에서 `"app/slot.ts"` 제거 → 9 → 8 GAP

---

## 4. 회귀 리스크 + 방어

| 리스크 | 영향 | 방어 |
|--------|------|------|
| `serverModuleSet` 중복 등록 | 내성적 (Set) | 자동 (중복 무시) |
| page.tsx + slot.ts 동시 변경 | 중복 호출? | No — classifyBatch 는 batch 단위 → `ssr-only` 분류 한 번만 |
| slot 없는 route | silent skip | OK — falsy 체크 자동 |
| `watchFSRoutes` 와 중복 처리 | 조정 필요 | 아래 §5 |

---

## 5. `watchFSRoutes` 제거 가능성

- slot 변경: `_doBuild` → `onSSRChange` (Phase 7.1 이후)
- **신규 route 추가** (`app/new-page.tsx` 생성): 여전히 manifest 재스캔 필요
- **결론**: `watchFSRoutes` **제거 불가** — 신규 route 감시 책임 유지
- **병행**: CLI 에서 두 watcher 동시 실행 (간섭 없음, slot 은 `_doBuild` 가 우선)

---

## 6. 매트릭스 복구 경로

1. `serverModuleSet` 에 slot 추가 (Option B)
2. (선택) `classifyBatch` 에 slot 인식
3. Test fixture: `spec/slots/home.slot.ts` 생성 → `app/page.tsx` 에 `slotModule` 링크
   - `scaffoldSSG` / `scaffoldHybrid` / `scaffoldFull` 각각에 slot 추가
4. `KNOWN_BUNDLER_GAPS` 에서 `"app/slot.ts"` 제거

---

## 7. 요약

| 항목 | 결정 |
|------|------|
| 통합 전략 | Option B (slot → serverModuleSet) |
| diff 크기 | ~15-20 라인 (dev.ts) |
| 회귀 리스크 | 낮음 (Set 자동 중복 제거) |
| watchFSRoutes 제거 | No (신규 route 감시 필요) |
| 매트릭스 복구 | [GAP] 3 cells → PASS (fixture + classifyBatch 각 1-2 줄) |
| 구현 난도 | 낮음 (3-4시간) |

---

## 파일:라인 참조

- `packages/core/src/bundler/dev.ts:388` — `serverModuleSet` 초기화
- `packages/core/src/bundler/dev.ts:415-426` — manifest 순회 (SSR 모듈 등록)
- `packages/core/src/bundler/dev.ts:548-645` — `classifyBatch`
- `packages/core/src/bundler/dev.ts:896-1036` — `_doBuild` 함수
- `packages/core/src/bundler/scenario-matrix.ts:42-55` — `CHANGE_KINDS` (slot 포함)
- `packages/core/src/bundler/scenario-matrix.ts:167-201` — `classifyBehavior` (slot → full-reload)
- `packages/core/src/router/fs-routes.ts:304-380` — `watchFSRoutes` (CLI 우회 경로)
- `packages/cli/src/commands/dev.ts:729-752` — `watchFSRoutes` onChange 콜백
- `packages/core/tests/hmr-matrix/matrix.spec.ts:105-107` — `KNOWN_BUNDLER_GAPS`
- `packages/cli/src/util/handlers.ts:150-195` — `registerPageHandler` (slotModule 사용 지점)
- `packages/core/src/spec/schema.ts:67` — `RouteSpec.slotModule` 필드

---

**결론**: Slot dispatch 통합은 **15-20 줄의 최소 변경**으로 `_doBuild` 내에 포함 가능하며, Option B (slot → `serverModuleSet`) 가 의미상/구현상 최적. Phase 7.1 fixture 생성 시 slot 테스트 파일 포함으로 3 GAP cell 자동 복구.
