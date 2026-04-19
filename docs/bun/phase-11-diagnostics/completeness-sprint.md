---
title: "Phase 11 R0 — 완성도 스프린트 (9.1 follow-up + 7.4)"
status: r0-plan
created: 2026-04-18
inputs:
  - docs/security/phase-9-audit.md (M-01/M-02, L-01~L-04, I-01/I-03)
  - docs/bun/phase-7-2-benchmarks.md §7
---

# Phase 11 R0 — 완성도 스프린트

Phase 9 merge 후 미해결 findings + Phase 7.3 미달 성능 항목을 3 에이전트 병렬로 정리. 1.0.0 직전 마지막 하드닝.

## 1. 구현 범위 + 시간

### A. 공급망 / DevOps

**[A-1] M-01 Signing + SLSA** — 1.5일 + 외부 대기, 3 분할:
1. **SLSA attestation** (즉시, 외부 비용 0): `.github/workflows/release-binaries.yml:39-41` `permissions` 에 `id-token: write` + `attestations: write` 추가. `build` job 끝에 `actions/attest-build-provenance@v2` 스텝 (+20 줄). SLSA L3. <https://github.com/actions/attest-build-provenance>
2. **Windows EV cert** (외부 1~2주): Azure Trusted Signing ($9.99/mo, cert 대행, HSM 불필요, 권장) vs Sectigo ($300/yr, HSM 2~5일) vs DigiCert ($500/yr). `azure/trusted-signing-action@v0.4.0` 로 windows job +15 줄. <https://learn.microsoft.com/en-us/azure/trusted-signing/>
3. **Apple Developer ID** (외부 1~2일, $99/yr): `apple-actions/import-codesign-certs@v3` + `codesign --options=runtime` + `xcrun notarytool submit`. macOS jobs 2개 +30 줄. <https://developer.apple.com/documentation/security/customizing-the-notarization-workflow>

**[A-2] I-01 Actions SHA pin** — 30분. 5 workflows × ~5 actions (`checkout@v4`, `setup-bun@v2`, `upload-artifact@v4`, `download-artifact@v4`, `action-gh-release@v2`) → commit SHA. `release-binaries.yml:85/88/209/235/280` + `ci.yml` + `publish.yml` + `ate-e2e.yml`. ~25 pin. <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>

### B. Installer / CLI 하드닝

**[B-1] L-04 renderMarkdown sanitizer** — 2시간. `packages/cli/src/cli-ux/markdown.ts:63-82` 에 `sanitizeControl()` — 0x00-0x08, 0x0B-0x1F, 0x7F, 0x80-0x9F 제거 (TAB/LF 예외). 테스트 5~7 case (`\x1b[2J`, OSC 8 `javascript:`, UTF-8 보존). +30 src, +80 tests.

**[B-2] L-01/L-02 Installer** — 4시간. `install.sh:34-36, 284-293` + `install.ps1:55, 213-238` + `install.bash:64-78`:
- **L-01** MANDU_REPO != default 시 `YEL WARNING` + `sleep 3` + Ctrl+C 안내 (+10 × 2)
- **L-02** MANDU_INSTALL_DIR allowlist (`case '*[^a-zA-Z0-9/._~\-]*'` reject). PowerShell `[^A-Za-z0-9:\\._~\-]` regex. `install.bash` raw fetch 직전에도 MANDU_REPO 검증 (+15 × 2)
- `smoke-install.sh` 확장 +40 줄

**[B-3] L-03 desktop --entry traversal** — 2시간. `packages/cli/src/commands/desktop.ts:153-168`:
```ts
const abs = path.resolve(options.cwd, options.entry);
const rel = path.relative(options.cwd, abs);
if (rel.startsWith("..") || path.isAbsolute(rel)) {
  throw new Error(`--entry must stay inside ${options.cwd}`);
}
```
Windows drive prefix 주의 — `path.relative("C:\\proj","D:\\evil")` ill-formed → `path.isAbsolute(rel)` 추가. <https://nodejs.org/api/path.html#pathrelativefrom-to>. 테스트 4 case (rel OK / `..` 거부 / POSIX abs 거부 / Win 다른 drive 거부). +15 src, +50 tests.

**[B-4] I-03 skills 임베딩** — 6시간. `packages/skills/src/init-integration.ts:67-78` 가 `$bunfs` read-only 에서 9회 ENOENT. 해법:
1. `packages/cli/scripts/generate-skills-manifest.ts` (신규, +180) — `packages/skills/skills/<id>/SKILL.md` 9개 + `templates/.claude/settings.json` walk
2. `packages/cli/generated/skills-manifest.{js,d.ts}` (신규, auto-gen) — `type: "text"` sync embed. `generate-template-manifest.ts:1-80` 패턴 재사용
3. `init-integration.ts` refactor — `copyFile` 제거, `SKILLS_MANIFEST.get` + `writeFile` (~50)
4. **방향성 주의**: `@mandujs/skills` → `@mandujs/cli/generated/*` 는 역방향 (circular). 대안 `packages/skills/generated/` + build-binary.ts 가 embed
5. 크기 영향 ~18KB (무시). `binary-landing.test.ts` 패턴으로 byte-identical + `copyFile/readFile` 가드 +50

### C. 성능 / 공급망 완화

**[C-1] M-02 FFI fallback** — 1.5일. `webview-bun` 1-maintainer 공급망 완화:
1. `packages/core/src/desktop/ffi-fallback.ts` (신규, ~80 LOC prototype) — 상류 `webview/webview` (C++ 14k★, <https://github.com/webview/webview>) prebuilt DLL 을 Mandu CDN 에 SHA-256 pin 미러링
2. `bun:ffi` 직접 바인딩 (<https://bun.sh/docs/api/ffi>):
   ```ts
   const { symbols } = dlopen(webviewPath, {
     webview_create: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
     webview_navigate: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.void },
     webview_run: { args: [FFIType.ptr], returns: FFIType.void },
   });
   ```
3. FFI 오버헤드 ~10 ns/call — webview API ms 비용 대비 무시 가능
4. `window.ts:75-105` 에 `MANDU_DESKTOP_INLINE_FFI=1` flag 분기. default 는 `webview-bun`. 감사 §M-02 방안 A-2 (prototype pollution 탐지: `mod.Webview.toString()` SHA-256) 추가. +300 (prototype + tests + docs)

**[C-2] 7.4 JIT prewarm 확장** — 1일. Phase 7.3 A 41→25 ms, 목표 ≤ 10 ms. `packages/cli/src/util/jit-prewarm.ts:69-74` 확장:
1. **Deep-import**: `@mandujs/core`, `@mandujs/core/bundler/safe-build`, `@mandujs/core/perf` → `registerManifestHandlers` (`handlers.ts:1-11`) 의 8 export tier-up. 예상 -5~8 ms
2. **Dummy Bun.build**: `port.listen` 이후 1-line 모듈 `safeBuild({ entrypoints:[fake], target:"bun" })` 1회 fire-and-forget — Transpiler/Linker tier-up. 예상 -8~12 ms. vendor cache 협업 시 dummy 도 cache-hit
3. **`@mandujs/core/client/router`** (hydration) — 약소 -1~2 ms

리스크: dummy CPU 사용하지만 `ready in Nms` 이후 emit. +60 src, +40 tests.

**[C-3] 7.4 Bun 1.3.13+ cold recheck** — 2~4시간, 릴리즈 종속. 현재 1.3.12 에서 `scripts/hmr-bench.ts:measureColdStart` 가 tmpdir 에서 `OutOfMemory` crash (Win). 작업: <https://bun.com/releases> 확인 → 새 버전 설치 → `hmr-bench.ts` 재측정 → `bunfig.toml` + `package.json engines.bun` bump. 2주 내 미출시 → Phase 12 이월. +1 config, ~200 benchmark.

## 2. 에이전트 배분 (3 병렬)

| Agent | 역할 | 항목 | Wall |
|---|---|---|---|
| **A** DevOps/Supply Chain | signing + Actions | A-1, A-2 | 2일 (외부 병렬) |
| **B** Security | CLI/installer/skills | B-1, B-2, B-3, B-4 | 2~3일 |
| **C** Perf/Compat | FFI + JIT + Bun | C-1, C-2, C-3 | 2.5일 |

**병렬성**: 파일 범위 완전히 분리. A=`.github/workflows/`, B=`install.*` + `cli/src/{cli-ux,commands/desktop,errors}` + `skills/`, C=`core/src/desktop/` + `util/jit-prewarm.ts` + `bunfig.toml`. R2 conflict 없음.

**Round**: R0 이 문서 → R1 A+B+C 병렬 → R2 security-engineer 재감사 (M-02 prototype + L-04) → R3 quality-engineer bench.

## 3. 파일별 변경 범위 + 충돌

| 파일 | Agent | 변경 | 충돌 |
|---|---|---|---|
| `.github/workflows/release-binaries.yml` | A | +80 | 없음 |
| `.github/workflows/{ci,publish,ate-e2e}.yml` | A | ~10 each | 없음 |
| `install.{sh,ps1,bash}` | B | +30 each | 없음 |
| `packages/cli/src/cli-ux/markdown.ts` | B | +30 | 없음 |
| `packages/cli/src/commands/desktop.ts` | B | +15 | Phase 9c 병합 가능 |
| `packages/skills/src/init-integration.ts` | B | ~50 refactor | 없음 |
| `packages/cli/scripts/generate-skills-manifest.ts` | B (신규) | +180 | 없음 |
| `packages/{cli,skills}/generated/skills-manifest.{js,d.ts}` | B (신규) | auto | 없음 |
| `packages/core/src/desktop/window.ts` | C | +30 | 없음 |
| `packages/core/src/desktop/ffi-fallback.ts` | C (신규) | +200 | 없음 |
| `packages/cli/src/util/jit-prewarm.ts` | C | +60 | 없음 |
| `bunfig.toml`, `package.json engines` | C | +1 | Phase 10 완료라 없음 |
| **tests** | B+C | +300 신규 | 없음 |

## 4. 우선순위

| 심각도 | 항목 | 착수 |
|---|---|---|
| 🔴 Critical | A-1 SLSA, A-2 SHA pin, B-1 ANSI, B-3 desktop entry | R1 Day 1 |
| 🟡 중요 | B-4 skills, B-2 installer filter | R1 Day 2 |
| 🟡 중요 | A-1 EV cert / Apple Dev | R1 외부 병렬 |
| 🟢 후순위 | C-1 FFI, C-2 JIT, C-3 Bun recheck | R2 |

## 5. R1 착수 체크리스트

**A**: attest-build-provenance@v2 PR / 5 workflows SHA pin 교체 / Azure Trusted Signing 평가 / Apple Dev 가입.
**B**: sanitizeControl +7 tests / installer +smoke 확장 / desktop containment +4 tests / skills generator + refactor +5 가드.
**C**: ffi-fallback prototype + flag / jit-prewarm 확장 + < 10 ms 증명 / Bun 1.3.13+ 릴리즈 확인 + recheck.

**완료 기준**: 1643 → ~1700 테스트 pass, 4 패키지 typecheck clean, R3 재감사 Critical/High 0 유지 + Medium 2 → 0. Phase 11 완료 → **1.0.0-rc.1 게이트**. Phase 12 는 observability + webview 상용화로 분리.

## 6. 참조

- 감사: `docs/security/phase-9-audit.md` §2-4
- 성능: `docs/bun/phase-7-2-benchmarks.md` §7.1-7.2
- 타겟: `install.sh:34,282`, `install.ps1:55,213`, `install.bash:64`, `packages/cli/src/cli-ux/markdown.ts:63-82`, `packages/cli/src/commands/desktop.ts:153-168`, `packages/skills/src/init-integration.ts:67-78`, `packages/cli/scripts/generate-template-manifest.ts:1-80` (패턴)
- SLSA/signing: <https://slsa.dev>, <https://github.com/actions/attest-build-provenance>, <https://learn.microsoft.com/en-us/azure/trusted-signing/>, <https://developer.apple.com/documentation/security/customizing-the-notarization-workflow>
- FFI: <https://bun.sh/docs/api/ffi>, <https://github.com/webview/webview>
