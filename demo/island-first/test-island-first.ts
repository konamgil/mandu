#!/usr/bin/env bun
/**
 * Island-First Rendering E2E Test
 * MCP 도구가 사용하는 core 함수들을 직접 호출하여 검증
 */

import { loadManifest, generateRoutes, runGuardCheck, needsHydration } from "@mandujs/core";
import fs from "fs/promises";
import path from "path";

const ROOT = import.meta.dir;
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

async function readFile(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(path.join(ROOT, filePath)).text();
  } catch {
    return null;
  }
}

// ─── Test 1: Load Manifest ───────────────────────────────────────
console.log("\n📋 Test 1: Manifest 로드");
const manifestPath = path.join(ROOT, "spec", "routes.manifest.json");
const manifestResult = await loadManifest(manifestPath);
assert(manifestResult.success === true, "manifest 로드 성공");
assert(manifestResult.data!.routes.length === 5, "5개 라우트 존재");

const manifest = manifestResult.data!;
const counterPage = manifest.routes.find(r => r.id === "counter-page")!;
const aboutPage = manifest.routes.find(r => r.id === "about-page")!;
const counterApi = manifest.routes.find(r => r.id === "counter-api")!;

assert(!!counterPage.clientModule, "counter-page에 clientModule 있음");
assert(!aboutPage.clientModule, "about-page에 clientModule 없음");
assert(counterApi.kind === "api", "counter-api는 API 라우트");

// ─── Test 2: Island 식별 (mandu_list_islands 동등) ───────────────
console.log("\n🏝️  Test 2: Island 식별");
const islands = manifest.routes.filter(r => r.kind === "page" && r.clientModule && needsHydration(r));
assert(islands.length === 1, "island 1개 (counter-page만)");
assert(islands[0].id === "counter-page", "counter-page가 island");
assert(!needsHydration(aboutPage), "about-page는 island 아님");

// ─── Test 3: Generate (mandu_generate 동등) ──────────────────────
console.log("\n⚙️  Test 3: Generate 실행");
const genResult = await generateRoutes(manifest, ROOT);
assert(genResult.success === true, "generate 성공");
assert(genResult.created.length > 0, `${genResult.created.length}개 파일 생성됨`);

// ─── Test 4: Island-First 템플릿 검증 ────────────────────────────
console.log("\n🔍 Test 4: Island-First 템플릿 검증");
const counterComponent = await readFile("apps/web/generated/routes/counter-page.route.tsx");
assert(counterComponent !== null, "counter-page 컴포넌트 생성됨");
assert(counterComponent!.includes("Island-First"), "Island-First 주석 포함");
assert(counterComponent!.includes("islandModule"), "islandModule import 포함");
assert(counterComponent!.includes("definition.setup"), "definition.setup 호출 포함");
assert(counterComponent!.includes("definition.render"), "definition.render 호출 포함");

const aboutComponent = await readFile("apps/web/generated/routes/about-page.route.tsx");
assert(aboutComponent !== null, "about-page 컴포넌트 생성됨");
assert(!aboutComponent!.includes("islandModule"), "about-page에는 islandModule 없음");
assert(!aboutComponent!.includes("Island-First"), "about-page에는 Island-First 없음");

// ─── Test 5: Guard Check 정상 (mandu_guard_check 동등) ───────────
console.log("\n🛡️  Test 5: Guard Check (정상 상태)");
const guardResult = await runGuardCheck(manifest, ROOT);
// Island-First 위반이 없어야 함
const islandViolations = guardResult.violations.filter(
  v => v.ruleId === "ISLAND_FIRST_INTEGRITY" || v.ruleId === "CLIENT_MODULE_NOT_FOUND"
);
assert(islandViolations.length === 0, "Island-First 위반 없음");

// ─── Test 6: 위반 시나리오 - componentModule 수동 수정 ────────────
console.log("\n⚠️  Test 6: 위반 시나리오 (수동 수정)");
const counterComponentPath = path.join(ROOT, "apps/web/generated/routes/counter-page.route.tsx");
const originalContent = await Bun.file(counterComponentPath).text();
// islandModule과 Island-First 마커를 제거하여 위반 상태 만들기
const brokenContent = originalContent
  .replace(/islandModule/g, "brokenModule")
  .replace(/Island-First/g, "Broken-Template");
await Bun.write(counterComponentPath, brokenContent);

const brokenGuard = await runGuardCheck(manifest, ROOT);
const integrityViolation = brokenGuard.violations.find(v => v.ruleId === "ISLAND_FIRST_INTEGRITY");
assert(!!integrityViolation, "ISLAND_FIRST_INTEGRITY 위반 감지됨");
if (integrityViolation) {
  assert(integrityViolation.file!.includes("counter-page"), "위반 파일이 counter-page");
  console.log(`    → message: ${integrityViolation.message}`);
  console.log(`    → suggestion: ${integrityViolation.suggestion}`);
}

// ─── Test 7: 복구 - 재생성 후 Guard 통과 ─────────────────────────
console.log("\n🔄 Test 7: 재생성 후 복구");
const regenResult = await generateRoutes(manifest, ROOT);
assert(regenResult.success === true, "재생성 성공");

const fixedGuard = await runGuardCheck(manifest, ROOT);
const fixedViolations = fixedGuard.violations.filter(
  v => v.ruleId === "ISLAND_FIRST_INTEGRITY" || v.ruleId === "CLIENT_MODULE_NOT_FOUND"
);
assert(fixedViolations.length === 0, "재생성 후 Island-First 위반 없음");

// ─── 결과 요약 ───────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log(`📊 결과: ${passed} passed, ${failed} failed (total ${passed + failed})`);
console.log("═".repeat(50));

if (failed > 0) {
  process.exit(1);
}
