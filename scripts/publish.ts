#!/usr/bin/env bun
/**
 * Mandu Publish Script
 *
 * workspace:* 의존성을 실제 버전으로 직접 치환한 뒤 bun publish 실행.
 * npm 배포 후 GITHUB_TOKEN이 있으면 GitHub Packages에도 dual publish.
 * 배포 후 원래 workspace:* 로 복원합니다.
 *
 * Usage:
 *   bun run scripts/publish.ts          # 실제 배포
 *   bun run scripts/publish.ts --dry-run # 미리보기
 */

import { $ } from "bun";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";

// Publish 순서: 의존성 위상 순서대로 (의존되는 것이 먼저)
// core → ate (needs core at runtime) → skills (peerDep core) → mcp (deps core+ate+skills)
//   → cli (deps core+mcp+skills) → edge (peerDep core, Workers adapter)
const PACKAGES = [
  "packages/core",
  "packages/ate",
  "packages/skills",
  "packages/mcp",
  "packages/cli",
  "packages/edge",
];
const ROOT = join(import.meta.dir, "..");
const isDryRun = process.argv.includes("--dry-run");
const skipCheck = process.argv.includes("--skip-check");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GPR_REGISTRY = "https://npm.pkg.github.com";
// 명시적 npm registry — ~/.npmrc의 registry= 라인이 verdaccio 등으로 설정돼 있어도
// public npmjs.org로 보내기 위함. NPM_REGISTRY 환경변수로 override 가능.
const NPM_REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org/";
// 2FA가 켜진 계정 대응 — NPM_OTP env var이 있으면 모든 bun publish 호출에 전달.
// OTP는 30초 유효하므로 publish 6개가 한 윈도우 안에 끝나야 한다.
const NPM_OTP = process.env.NPM_OTP;

// Pre-publish check
if (!skipCheck) {
  console.log("🔍 Running pre-publish check...\n");
  try {
    execSync("bun run scripts/pre-publish-check.ts", { stdio: "inherit", cwd: ROOT });
  } catch (err) {
    console.error("\n❌ Pre-publish check failed!");
    process.exit(1);
  }
  console.log();
}

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

async function getPublishedVersion(name: string): Promise<string | null> {
  try {
    // ~/.npmrc의 registry=가 verdaccio로 설정돼 있어도 public npm에서 조회
    const result = await $`npm view ${name} version --registry=${NPM_REGISTRY}`.text();
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * 모든 workspace 패키지의 name → version 매핑 생성
 */
async function buildVersionMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const pkgJson: PackageJson = JSON.parse(
      await readFile(join(ROOT, pkg, "package.json"), "utf-8")
    );
    map.set(pkgJson.name, pkgJson.version);
  }
  return map;
}

/**
 * Root package.json의 `catalog` 사전 로드 (Bun/pnpm workspace catalog).
 * 패키지 deps에 "catalog:" literal이 있으면 이 사전을 lookup해서 실버전 치환.
 *
 * 이슈 #271: 이 resolve 단계가 누락되어 `fast-glob: catalog:`가 그대로 npm에
 * publish되었고, 모든 신규 install이 실패했음. publish.ts가 root catalog를
 * 인지하고 자동 치환하도록 추가.
 */
async function loadRootCatalog(): Promise<Record<string, string>> {
  const rootPkg: Record<string, unknown> = JSON.parse(
    await readFile(join(ROOT, "package.json"), "utf-8")
  );
  const ws = rootPkg.workspaces;
  if (ws && typeof ws === "object" && !Array.isArray(ws)) {
    const catalog = (ws as Record<string, unknown>).catalog;
    if (catalog && typeof catalog === "object" && !Array.isArray(catalog)) {
      return catalog as Record<string, string>;
    }
  }
  const topLevel = rootPkg.catalog;
  if (topLevel && typeof topLevel === "object" && !Array.isArray(topLevel)) {
    return topLevel as Record<string, string>;
  }
  return {};
}

/**
 * package.json의 workspace:* / catalog: 참조를 실제 버전으로 치환.
 * 원본 내용을 반환하여 복원에 사용. 마지막에 잔여 workspace:/catalog:가
 * 남아있으면 throw — leak을 publish 전에 차단 (이슈 #271).
 */
async function resolveWorkspaceDeps(
  pkgPath: string,
  versionMap: Map<string, string>,
  catalog: Record<string, string>
): Promise<{ original: string; resolved: boolean }> {
  const filePath = join(pkgPath, "package.json");
  const original = await readFile(filePath, "utf-8");
  const pkgJson: PackageJson = JSON.parse(original);
  let resolved = false;

  for (const deps of [pkgJson.dependencies, pkgJson.devDependencies]) {
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (version.startsWith("workspace:")) {
        const actualVersion = versionMap.get(name);
        if (actualVersion) {
          deps[name] = `^${actualVersion}`;
          resolved = true;
        }
      } else if (version === "catalog:" || version.startsWith("catalog:")) {
        const tag = version === "catalog:" ? "" : version.slice("catalog:".length);
        const lookup = tag ? `${name}@${tag}` : name;
        const actualVersion = catalog[lookup] ?? catalog[name];
        if (actualVersion) {
          deps[name] = actualVersion;
          resolved = true;
        } else {
          throw new Error(
            `Cannot resolve "catalog:" ref for ${name} in ${filePath} — ` +
              `not found in root package.json catalog. Add it to "workspaces.catalog" or use an explicit version.`
          );
        }
      }
    }
  }

  // Final leak guard — publish-time safety net (이슈 #271 회귀 방지).
  // npm registry는 이런 spec prefix들을 resolve 못 함:
  //   workspace: — Bun/pnpm workspace ref
  //   catalog:   — Bun/pnpm workspace catalog ref
  //   link:      — symlink to sibling
  //   portal:    — Yarn berry portal (workspace-like)
  //   file:      — local path (works in install but bad UX for npm users)
  //   github:    — github shorthand (works but unreliable for prod)
  //   git+...:   — git protocol (slow + unreliable)
  // 새 type이 생길 수 있으니 화이트리스트 방식: ^, ~, 절대버전, version range만 통과.
  const SAFE_SPEC_RE = /^(\^|~|<|>|=|\d)|^(latest|next|beta|alpha|canary|\*)$/;
  for (const deps of [pkgJson.dependencies, pkgJson.devDependencies, pkgJson.peerDependencies, pkgJson.optionalDependencies]) {
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (!SAFE_SPEC_RE.test(version)) {
        throw new Error(
          `Unpublishable dep spec in ${filePath} after resolution: ${name}=${version}. ` +
            `npm registry cannot install this. Aborting publish.`
        );
      }
    }
  }

  if (resolved) {
    await writeFile(filePath, JSON.stringify(pkgJson, null, 2) + "\n");
  }

  return { original, resolved };
}

/**
 * package.json을 원본으로 복원
 */
async function restorePackageJson(pkgPath: string, original: string): Promise<void> {
  await writeFile(join(pkgPath, "package.json"), original);
}

/**
 * GitHub Packages(GPR)에 배포
 * 임시 .npmrc를 패키지 디렉토리에 생성 후 배포, 완료 후 삭제
 */
async function publishToGPR(pkgPath: string, pkgName: string): Promise<void> {
  const npmrcPath = join(pkgPath, ".npmrc");
  const npmrcContent = [
    `@mandujs:registry=${GPR_REGISTRY}`,
    `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`,
    "",
  ].join("\n");

  try {
    await writeFile(npmrcPath, npmrcContent);

    if (isDryRun) {
      console.log(`   📦 GPR dry-run: would publish ${pkgName} to ${GPR_REGISTRY}`);
    } else {
      await $`cd ${pkgPath} && bun publish --access public`.text();
      console.log(`   ✅ GPR published successfully`);
    }
  } finally {
    // 항상 임시 .npmrc 삭제
    try {
      await unlink(npmrcPath);
    } catch {
      // .npmrc가 없으면 무시
    }
  }
}

async function main() {
  console.log(isDryRun ? "🔍 Dry run mode\n" : "🚀 Publishing packages\n");

  if (GITHUB_TOKEN) {
    console.log("🔑 GITHUB_TOKEN detected — dual publish (npm + GitHub Packages)\n");
  } else {
    console.log("ℹ️  No GITHUB_TOKEN — npm only (set GITHUB_TOKEN to enable GitHub Packages)\n");
  }

  const versionMap = buildVersionMap();
  const versions = await versionMap;
  const catalog = await loadRootCatalog();

  console.log("📋 Workspace versions:");
  for (const [name, version] of versions) {
    console.log(`   ${name}@${version}`);
  }
  if (Object.keys(catalog).length > 0) {
    console.log("📚 Root catalog entries (will replace `catalog:` refs):");
    for (const [name, version] of Object.entries(catalog)) {
      console.log(`   ${name}@${version}`);
    }
  }
  console.log();

  // Tracks packages we actually publish in this run so we can tag
  // them at the end. Tags are required by the
  // .github/workflows/release-binaries.yml `@mandujs/cli@*` trigger —
  // without an annotated tag push, no GitHub Release / standalone
  // binary gets cut, and the install.ps1 / install.sh one-liners
  // 404 on first download. See issue #257.
  const publishedPackages: Array<{ name: string; version: string }> = [];

  for (const pkg of PACKAGES) {
    const pkgPath = join(ROOT, pkg);
    const pkgJson: PackageJson = JSON.parse(
      await readFile(join(pkgPath, "package.json"), "utf-8")
    );

    const published = await getPublishedVersion(pkgJson.name);
    const alreadyOnNpm = published === pkgJson.version;

    if (!isDryRun && alreadyOnNpm && !GITHUB_TOKEN) {
      console.log(`⏭️  ${pkgJson.name}@${pkgJson.version} — already on npm, skipping`);
      continue;
    }

    console.log(`📦 ${pkgJson.name}@${pkgJson.version} (npm: ${published ?? "not found"})`);

    // workspace:* + catalog: → 실제 버전으로 치환 (이슈 #271 catalog leak 차단)
    const { original, resolved } = await resolveWorkspaceDeps(pkgPath, versions, catalog);
    if (resolved) {
      console.log(`   🔗 workspace:* / catalog: → resolved to actual versions`);
    }

    try {
      // 1) npm 배포
      if (isDryRun) {
        if (alreadyOnNpm) {
          console.log(`   🔎 npm: already published, still running dry-run package validation`);
        }
        const result = await $`cd ${pkgPath} && bun publish --dry-run --registry=${NPM_REGISTRY}`.text();
        console.log(result);
      } else if (alreadyOnNpm) {
        console.log(`   ⏭️  npm: already published, skipping`);
      } else {
        // --tag latest 명시: orphan/squatted 상위 버전이 npm에 있을 때 (skills 16.0.0
        // 등 외부 점유) npm은 implicit latest tagging을 거부함. 명시하면 강제 적용.
        // --otp는 NPM_OTP 있을 때만 추가.
        const result = NPM_OTP
          ? await $`cd ${pkgPath} && npm publish --access public --tag latest --registry=${NPM_REGISTRY} --otp=${NPM_OTP}`.text()
          : await $`cd ${pkgPath} && npm publish --access public --tag latest --registry=${NPM_REGISTRY}`.text();
        console.log(`   ✅ Published to npm`);
        console.log(result);
        publishedPackages.push({ name: pkgJson.name, version: pkgJson.version });
      }

      // 2) GitHub Packages 배포
      if (GITHUB_TOKEN) {
        try {
          await publishToGPR(pkgPath, pkgJson.name);
        } catch (gprErr) {
          console.warn(`   ⚠️  GPR publish failed for ${pkgJson.name}`);
          console.warn(`   ${gprErr}`);
        }
      }
    } catch (err) {
      console.error(`   ❌ Failed to publish ${pkgJson.name}`);
      console.error(err);
      // 실패해도 원본 복원
      if (resolved) await restorePackageJson(pkgPath, original);
      process.exit(1);
    }

    // 원본 복원 (workspace:* 유지)
    if (resolved) {
      await restorePackageJson(pkgPath, original);
      console.log(`   🔄 Restored workspace:* in package.json`);
    }
  }

  // Push annotated git tags for every package we just published.
  //
  // Why annotated and not lightweight: GitHub Actions `on.push.tags`
  // triggers fire reliably for annotated tags but skipped lightweight
  // ones in our setup (release-binaries.yml never ran when tags were
  // created with bare `git tag <name>`). Annotated tags also carry a
  // tagger identity which makes `gh release` / SLSA attestations
  // happier. Tag name format mirrors what changesets would emit
  // (`@scope/name@version`) so any tooling pinned to that shape keeps
  // working.
  if (!isDryRun && publishedPackages.length > 0) {
    console.log("\n🏷️  Tagging published packages...");
    for (const { name, version } of publishedPackages) {
      const tag = `${name}@${version}`;
      const exists = await $`git rev-parse -q --verify refs/tags/${tag}`
        .quiet()
        .nothrow();
      if (exists.exitCode === 0) {
        console.log(`   ⏭️  ${tag} — tag already exists, skipping`);
        continue;
      }
      try {
        await $`git tag -a ${tag} -m ${tag}`.quiet();
        await $`git push origin ${tag}`.quiet();
        console.log(`   ✅ Pushed tag ${tag}`);
      } catch (err) {
        console.warn(
          `   ⚠️  Failed to push tag ${tag} — push manually with:\n      git tag -a ${tag} -m ${tag} && git push origin ${tag}`
        );
        console.warn(`   ${err}`);
      }
    }
  }

  console.log("\n✨ Done!");
}

main();
