# Mandu Labs Policy

작성일: 2026-08-13
상태: Active

Mandu의 안정 제품은 `@mandujs/core`, `@mandujs/cli`, `@mandujs/mcp` 세 패키지다. Labs는 유용한 실험을 보존하되 기본 설치, Golden Path, 안정성 약속, 제품 릴리스 게이트에서는 제외한다.

## 공통 계약

- 사용자가 명시적으로 설치하거나 활성화해야 한다.
- stable package에서 Labs runtime import를 만들 수 없다.
- breaking change가 허용되며 semver 호환은 각 Labs package가 별도로 선언한다.
- Labs 테스트 실패는 product release를 차단하지 않는다. CI에는 결과를 계속 노출한다.
- 두 분기 동안 maintainer, 사용 증거, 성공 지표가 없으면 archive 후보가 된다.
- provider 배포 운영과 credential 관리는 Mandu 제품 범위가 아니다.

## 현재 상태

| 영역 | 상태 | opt-in 경로 | 승격 기준 |
|---|---|---|---|
| ATE (`@mandujs/ate`) | Experimental | 직접 devDependency 설치 | 독립 Golden Path, flaky rate < 1%, action API 연동 |
| Edge (`@mandujs/edge`) | Experimental | adapter 직접 설치 | 지원 runtime matrix와 provider별 contract test |
| Playground runner | Prototype/private | 저장소 개발 환경에서만 실행 | 격리·보안 모델과 운영 owner 확정 |
| Kitchen | Compatibility Labs (Core 내부) | devtools 명시 활성화 | Core에서 추출하고 오류 계약·브라우저 테스트 고정 |
| AI Brain/chat | Prototype | 별도 실험 명령/패키지 | provider-neutral contract, 평가셋, 비용·보안 정책 |
| Design/Desktop/A11y helpers | Experimental | 명시적 subpath/기능 활성화 | owner와 재현 가능한 품질 gate 확보 |

## 릴리스 열차

- Product: `core -> mcp -> cli`; `bun run test:product`, `bun run check:product-release`, `bun run publish:product`
- Generated: `skills`; canonical action catalog 기반 산출물로 독립 검증
- Labs: `ate`, `edge`, `playground-runner`; non-blocking CI와 독립 릴리스

전체 저장소 검증인 `bun run test:packages`는 세 열차를 모두 실행하지만, 제품 배포 워크플로우는 Product 열차만 필수로 취급한다.
