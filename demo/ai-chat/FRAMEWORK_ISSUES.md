# Mandu Framework Issues Report

ai-chat 데모 개발 과정에서 발견된 프레임워크 이슈 목록

**테스트 환경**: Windows 10 Pro, Bun 1.3.10, Mandu MCP v0.12.0
**날짜**: 2026-04-10
**작성**: ai-chat 데모 앱 신규 개발 중 발견

---

## P0 - 크래시 / 데이터 손실 위험

### 1. Doctor 조언 따르면 런타임 크래시

- **증상**: `mandu_doctor`가 `"componentModule이 island을 import하지 않습니다"` 경고 → 조언대로 island을 page.tsx에서 `export { default } from "./chat-app.island"` 하면 `FRAMEWORK_BUG: Element type is invalid: expected a string ... but got: object` 크래시
- **원인**: `island()` 반환값은 React 컴포넌트가 아닌 island 설정 객체. page.tsx에서 직접 export/렌더링하면 SSR 렌더링 실패
- **영향**: Doctor를 믿고 따른 개발자가 앱 크래시를 경험
- **수정 제안**: Doctor가 올바른 패턴을 안내해야 함 — `.island.tsx` 파일은 같은 디렉토리에 배치하되 page.tsx는 `data-island` 속성으로 연결
- **관련 파일**: `packages/mcp/src/tools/brain.ts`, guard check 로직

### 2. Dev 서버 좀비 프로세스 — 포트 영구 점유

- **증상**: `mandu_dev_stop` 후에도 이전 dev 서버 프로세스가 살아있어 포트를 계속 점유
- **원인**: MCP의 `dev_stop`이 자식 프로세스(Bun, Tailwind CSS watcher 등)를 완전히 kill하지 못함
- **결과**: 반복 실행 시 3333→3335→3337→... 포트가 계속 밀려남. `taskkill /F /PID`로 수동 정리해야 함
- **수정 제안**: `dev_stop` 시 프로세스 트리 전체를 kill (Windows: `taskkill /T`, Unix: `kill -9 -pgid`)
- **관련 파일**: `packages/mcp/src/tools/project.ts`

---

## P1 - 개발 경험에 직접적 영향

### 3. `data-mandu-island` 래퍼 div가 레이아웃 파괴

- **증상**: SSR 시 만두가 삽입하는 `<div data-mandu-island="index">` 래퍼에 CSS 클래스가 없어서 flex 체인이 끊김
- **재현**:
  ```html
  <div class="h-screen flex flex-col">     ← layout (flex 컨테이너)
    <div data-mandu-island="index">         ← 만두가 삽입한 빈 div
      <div class="flex-1">                  ← flex-1 동작 안 함 (부모가 flex가 아님)
  ```
- **결과**: 채팅앱, 대시보드 등 전체 화면을 채우는 레이아웃에서 높이가 0이 됨
- **우회**: island 컴포넌트에서 직접 `height: 100vh` 사용
- **수정 제안**: 래퍼에 `style="display:contents"` 적용하거나, 래퍼 없이 렌더링하는 옵션 제공
- **관련 파일**: `packages/core/src/` SSR 렌더링 코드 (renderToHTML)

### 4. Island import 경로 틀려도 에러 메시지 없음

- **증상**: `import { island } from "@mandujs/core"` (서버 모듈)로 import하면 빌드가 `"No islands to bundle"` 로 조용히 실패
- **원인**: client island은 반드시 `@mandujs/core/client`에서 import해야 하지만, 에러/경고 없음
- **결과**: 왜 island이 번들링 안 되는지 원인 파악에 시간 소모
- **수정 제안**: 빌드 시 island 파일의 import를 검사하여 `"Island detected but uses server import. Use '@mandujs/core/client' instead"` 에러 출력
- **관련 파일**: `packages/core/src/bundler/build.ts`

### 5. config 포트 설정이 조용히 무시됨

- **증상**: `mandu.config.ts`에 `server: { port: 3333 }` 설정했지만, 포트 사용 불가 시 에러 없이 다음 빈 포트(3335, 3337...)로 자동 이동
- **결과**: 개발자가 3333에 접속해도 응답 없음. 어디로 접속해야 하는지 모름
- **수정 제안**: config 포트 사용 불가 시 에러 출력 + 포트 정리 안내 (`"Port 3333 is in use. Kill the process or change the port"`)
- **관련 파일**: `packages/core/src/server/` 서버 시작 로직

### 6. `mandu_dev_start` 반환값에 실제 포트 없음

- **증상**: MCP `mandu_dev_start` 응답이 `{ success: true, pid: 12345 }` 만 반환. 실제 포트 번호가 없음
- **결과**: MCP를 사용하는 AI/도구가 서버 URL을 알 수 없어 매번 로그를 파싱해야 함
- **수정 제안**: `{ success: true, pid: 12345, port: 3333, url: "http://localhost:3333" }` 반환
- **관련 파일**: `packages/mcp/src/tools/project.ts`

### 7. Kitchen DevTools 포트 하드코딩

- **증상**: `mandu_kitchen_errors` MCP 도구가 `http://localhost:4567` 에 연결 시도하지만, 실제 dev 서버는 다른 포트
- **원인**: Kitchen endpoint URL이 todo-app 기본값(4567)으로 하드코딩되어 있음
- **결과**: ai-chat 등 다른 프로젝트에서 Kitchen DevTools 사용 불가
- **수정 제안**: 현재 실행 중인 dev 서버 포트를 자동 감지하거나, `mandu_dev_start` 시 저장한 포트 참조
- **관련 파일**: `packages/mcp/src/tools/` kitchen 관련 코드

---

## P2 - 개발 효율성 저하

### 8. Guard가 `src/shared/types.ts` 파일을 차단 — 비직관적

- **증상**: `src/shared/types.ts` (단일 파일)은 Guard 위반이지만 `src/shared/types/index.ts` (디렉토리)는 통과
- **원인**: Guard 허용 패턴이 `shared/contracts|schema|types|utils/...` 인데, `types`는 디렉토리명만 매칭
- **결과**: 소규모 프로젝트에서 불필요하게 디렉토리를 만들어야 함
- **수정 제안**: `src/shared/types.ts` 단일 파일도 허용하거나, 에러 메시지에 `"types.ts → types/index.ts 또는 types/ 디렉토리로 이동하세요"` 명시
- **관련 파일**: `packages/core/src/guard/`

### 9. MCP 서버 하위 프로젝트 설정 가이드 부재

- **증상**: monorepo 하위 프로젝트(demo/ai-chat)에서 `.mcp.json`의 `cwd: "../.."` 방식이 동작하지 않음
- **시도한 것**: 절대경로 `cwd`, 상대경로 `cwd` — 모두 `"Failed to reconnect"` 실패
- **해결**: `@mandujs/mcp`를 devDependency로 추가 + `"args": ["run", "node_modules/@mandujs/mcp/src/index.ts"]`
- **수정 제안**: 공식 문서에 monorepo 하위 프로젝트 MCP 설정 가이드 추가. 또는 `mandu init` 시 `.mcp.json` 자동 생성
- **관련**: `packages/mcp/README.md` 또는 공식 문서

### 10. HMR 중 빌드 실패 시 복구 불가

- **증상**: dev 서버 실행 중 island 파일 수정 시 HMR이 번들 재빌드를 시도하지만, `AggregateError: Bundle failed` 에러 후 복구되지 않음
- **에러**: `[Router] AggregateError: Bundle failed`, `[_react] AggregateError: Bundle failed` 등
- **결과**: dev 서버를 완전히 재시작해야만 변경사항 반영
- **수정 제안**: HMR 빌드 실패 시 이전 번들을 유지하고, 다음 변경에서 재시도. 또는 에러 원인을 구체적으로 표시
- **관련 파일**: `packages/core/src/bundler/` HMR/watch 로직

### 11. Island-First 패턴 문서화 부족

- **증상**: island을 연결하는 방법이 여러 가지 (`data-island`, `.island.tsx`, `.client.tsx`, `spec/slots/`) 혼재하여 어떤 패턴이 정석인지 불명확
- **혼란 포인트**:
  - `data-island="chat-app"` 속성명 vs `data-mandu-island="index"` (프레임워크 생성) 차이
  - `app/chat-app.island.tsx` vs `spec/slots/chat-app.client.tsx` 중 어느 것을 사용해야 하는지
  - todo-app은 `spec/slots/*.client.tsx` 패턴, ai-chat은 `app/*.island.tsx` 패턴 — 표준이 뭔지 불명확
- **수정 제안**: 공식 가이드에 "Island 연결 표준 패턴" 문서 추가. 하나의 표준 방식을 권장

---

## P3 - Windows 호환성

### 12. Watcher의 `nul` 경로 에러 (Windows)

- **증상**: monorepo 루트에서 MCP 서버 시작 시 `[Watch] Error: EISDIR: illegal operation on a directory, scandir 'C:\Users\...\mandu\nul'`
- **원인**: Windows에서 `nul`은 `/dev/null` 동등한 예약 디바이스명. chokidar 또는 경로 처리 코드에서 `nul`이 실제 파일 경로로 해석됨
- **영향**: 에러 자체는 non-fatal이지만 stderr를 오염시키고, MCP stdio 통신에 간섭 가능성
- **수정 제안**: Windows에서 `nul` 예약어를 경로에 포함하지 않도록 필터링
- **관련 파일**: `packages/core/src/watcher/watcher.ts`, chokidar 설정

---

## 요약

| 우선순위 | 이슈 수 | 핵심 |
|---------|--------|------|
| **P0** | 2 | Doctor 조언 → 크래시, 좀비 프로세스 → 포트 점유 |
| **P1** | 5 | 래퍼 div 레이아웃 파괴, import 에러 무음, 포트 설정 무시, MCP 반환값 부족, Kitchen 하드코딩 |
| **P2** | 4 | Guard 비직관적, MCP 설정 가이드 부재, HMR 복구 불가, Island 패턴 혼란 |
| **P3** | 1 | Windows nul 경로 |

### 13. SSE ReadableStream이 React hydration root 내에서 메인 스레드 블록 (P0)

- **증상**: island 컴포넌트 내에서 `fetch().then(res => res.body.getReader())` + `while(true) { reader.read() }` 패턴 사용 시 메인 스레드 완전 블록. `page.evaluate()`, 클릭, 스크롤 전부 불가
- **영향**: SSE 실시간 스트리밍 불가. AI 채팅, 실시간 데이터 피드 등 핵심 기능 불가
- **테스트 증거**:
  - 순수 HTML 페이지에서 동일 코드 → **정상 동작** (스트리밍 OK, 페이지 responsive)
  - 만두 island 내에서 동일 코드 → **메인 스레드 블록** (30초 타임아웃)
  - `fetch`, `XHR.onprogress`, `EventSource`, 심지어 `Web Worker + postMessage` 전부 동일 현상
  - `res.text()`로 전체 수신 후 한번에 표시 → **정상 동작** (스트리밍 UX 없음)
- **추정 원인**: React 19의 hydration root가 microtask 스케줄링에 개입하여 ReadableStream reader의 `await reader.read()` 체인을 블로킹. `hydrateRoot()`로 생성된 root 컨텍스트 내에서만 발생
- **현재 우회**: `res.text()`로 전체 응답 수신 후 한번에 렌더링 (스트리밍 UX 포기)
- **수정 제안**: 
  1. `createRoot()` 대신 `hydrateRoot()` 사용 시 ReadableStream 호환성 테스트
  2. island 런타임에서 streaming fetch를 위한 유틸리티 제공 (`Mandu.stream()`)
  3. 또는 Bun 서버의 chunked response 전송 방식 검토
- **관련 파일**: `packages/core/src/bundler/build.ts` (런타임), `packages/core/src/client/` (island hydration)

---

**총 13건** — P0 3건은 즉시 수정 필요
