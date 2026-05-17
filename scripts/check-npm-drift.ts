#!/usr/bin/env bun
/**
 * Check for drift between local package.json versions and npm registry.
 *
 * Why this exists:
 *   - 이번 세션에 ate / skills 의 local `package.json` 이 1.0.0 으로 long-
 *     standing drift 상태였음 (npm latest는 각각 0.25.2 / 0.19.1). 그 결과
 *     첫 publish 시도가 "1.0.0 already exists" / "version conflict" 로 깨졌고,
 *     ate@1.0.0 은 결국 깨진 catalog leak 까지 같이 publish 되어 #271 사고로
 *     이어짐.
 *   - 로컬과 npm 간 drift 를 release 전에 잡으면 그 사고 분류 자체가 사라짐.
 *
 * Output:
 *   - clean        — local version == npm latest
 *   - ahead        — local > npm latest (정상, publish 대기 상태)
 *   - reserved     — local 이 npm versions 배열에 이미 존재 (다른 tag로 점유됨)
 *                     → 그 버전으로 publish 시도하면 reject 됨
 *   - behind       — local < npm latest (역행 — 거의 항상 버그)
 *   - missing      — npm 에서 패키지 자체를 찾을 수 없음 (이름 오타?)
 *
 * Exit codes:
 *   0 — clean / ahead 만 있음 (publishable state)
 *   1 — reserved / behind / missing 발견
 *
 * Usage:
 *   bun run scripts/check-npm-drift.ts            # human output
 *   bun run scripts/check-npm-drift.ts --json     # CI / scripting
 */

import { $ } from "bun";
import { readFile } from "fs/promises";
import { join } from "path";

const PACKAGES = [
  "packages/core",
  "packages/ate",
  "packages/skills",
  "packages/mcp",
  "packages/cli",
  "packages/edge",
];

const ROOT = join(import.meta.dir, "..");
const NPM_REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org/";
const isJsonMode = process.argv.includes("--json");

type Status = "clean" | "ahead" | "reserved" | "behind" | "missing";

interface Report {
  name: string;
  local: string;
  npmLatest: string | null;
  status: Status;
  detail: string;
}

async function fetchNpm(name: string): Promise<{ latest: string | null; versions: string[] }> {
  // Single round-trip — `npm view <name>` returns latest version on stdout
  // and a manifest the JSON form of which contains the full versions array.
  try {
    const text = await $`npm view ${name} --json --registry=${NPM_REGISTRY}`.text();
    const parsed = JSON.parse(text);
    return {
      latest: typeof parsed.version === "string" ? parsed.version : null,
      versions: Array.isArray(parsed.versions) ? parsed.versions : [],
    };
  } catch {
    return { latest: null, versions: [] };
  }
}

function compareSemver(a: string, b: string): number {
  // Conservative compare for the shape we use (x.y.z, sometimes -pre). Good
  // enough to detect "local < npm" without pulling in semver dep.
  const parse = (v: string) => v.split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const aa = parse(a);
  const bb = parse(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const da = aa[i] ?? 0;
    const db = bb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

async function reportPackage(pkgDir: string): Promise<Report> {
  const pkg = JSON.parse(await readFile(join(ROOT, pkgDir, "package.json"), "utf-8"));
  const local: string = pkg.version;
  const name: string = pkg.name;
  const { latest, versions } = await fetchNpm(name);

  if (latest === null) {
    return {
      name,
      local,
      npmLatest: null,
      status: "missing",
      detail: `package not found on npm registry (${NPM_REGISTRY})`,
    };
  }

  if (local === latest) {
    return { name, local, npmLatest: latest, status: "clean", detail: "in sync with npm latest" };
  }

  if (versions.includes(local)) {
    return {
      name,
      local,
      npmLatest: latest,
      status: "reserved",
      detail: `local version ${local} already exists on npm under a non-latest tag (or was unpublished — slot reserved). Publish will fail.`,
    };
  }

  const cmp = compareSemver(local, latest);
  if (cmp < 0) {
    return {
      name,
      local,
      npmLatest: latest,
      status: "behind",
      detail: `local ${local} < npm latest ${latest} — local has been rolled back? Investigate before publish.`,
    };
  }

  return {
    name,
    local,
    npmLatest: latest,
    status: "ahead",
    detail: `local ${local} > npm latest ${latest} — ready to publish.`,
  };
}

const reports = await Promise.all(PACKAGES.map(reportPackage));
const blocking = reports.filter((r) => r.status === "reserved" || r.status === "behind" || r.status === "missing");

if (isJsonMode) {
  process.stdout.write(JSON.stringify({ reports, blocking: blocking.length }, null, 2) + "\n");
} else {
  console.log("🔍 npm drift check\n");
  for (const r of reports) {
    const icon = { clean: "✅", ahead: "📈", reserved: "🚫", behind: "⬇️", missing: "❓" }[r.status];
    const npm = r.npmLatest ?? "<missing>";
    console.log(`  ${icon} ${r.name.padEnd(20)} local=${r.local.padEnd(8)} npm=${npm.padEnd(8)} — ${r.detail}`);
  }
  console.log();
  if (blocking.length > 0) {
    console.error(`❌ ${blocking.length} blocking issue(s) — fix before \`bun run release\`.`);
  } else {
    console.log("✨ No drift. Safe to publish.");
  }
}

process.exit(blocking.length > 0 ? 1 : 0);
