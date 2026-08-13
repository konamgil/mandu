# Core v1 public API boundary

작성일: 2026-08-13
상태: Current

`@mandujs/core`의 공개 계약은 11개 stable entry와 하나의 임시
compatibility entry로 제한한다. 앱 코드와 공식 문서는 stable entry만
사용해야 한다.

## Stable entries

| Import | 책임 |
|---|---|
| `@mandujs/core` | 일상적인 앱 작성 primitive |
| `@mandujs/core/client` | 브라우저와 island client API |
| `@mandujs/core/config` | 설정 정의와 검증 |
| `@mandujs/core/contract` | API contract |
| `@mandujs/core/error` | 공개 error/diagnostic type |
| `@mandujs/core/guard` | architecture rule authoring |
| `@mandujs/core/middleware` | request middleware |
| `@mandujs/core/plugins` | plugin authoring hook |
| `@mandujs/core/router` | route authoring API |
| `@mandujs/core/runtime` | 문서화된 runtime integration |
| `@mandujs/core/testing` | 공식 test helper |

## Compatibility entry

`@mandujs/core/compat/*`는 v0 subpath를 기존 구현으로 전달하는 R2
호환 계층이다. stable API가 아니며 새 앱 코드에서 사용하면 안 된다.
예를 들어 이전 `@mandujs/core/resource` import는
`@mandujs/core/compat/resource/index`로 이동한다.

마이그레이션 방법과 예외는
[`Core v1 surface migration`](../migration/core-v1-surface.md)에 정의한다.

## 금지된 공개 표면

bundler, compiler, generator, lockfile, watcher, deploy, Kitchen, desktop,
AI brain과 runtime server 세부 구현은 v1 stable 계약이 아니다. 필요한
기존 코드는 compatibility entry 뒤에서만 유지하고, 공식 문서와 새 코드에
추가하지 않는다.

## 변경 규칙

- stable entry의 제거·이름 변경·호환되지 않는 signature 변경은 major와
  migration note가 필요하다.
- 새 export map entry는 12개 예산 안에서 기존 entry를 통합하거나 제품
  constitution 변경을 동반해야 한다.
- root `export *`는 앱 작성 primitive allowlist만 통과할 수 있다.
- compatibility entry는 v1 beta 제거 후보이며 사용량을 늘리지 않는다.

## 자동 검증

```bash
bun run check:public-api
bun run check:core-v1-imports
```

첫 명령은 export map 수·분류와 root barrel을 검사한다. 두 번째 명령은
저장소 source에 옛 subpath import가 다시 들어오는 것을 막는다. 두 검사는
CI와 publish gate에서 실행된다.
