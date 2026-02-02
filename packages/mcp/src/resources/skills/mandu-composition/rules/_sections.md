# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Component Architecture (comp-arch)

**Impact:** HIGH
**Description:** Boolean props 대신 컴포지션 사용, 컴파운드 컴포넌트 구조화. 코드베이스가 확장됨에 따라 유지보수성에 큰 영향을 미칩니다.

## 2. State Management (comp-state)

**Impact:** HIGH
**Description:** state/actions/meta 인터페이스 정의, Provider를 통한 의존성 주입. 같은 UI를 다양한 상태 구현과 함께 재사용할 수 있게 합니다.

## 3. Island Patterns (comp-island)

**Impact:** MEDIUM
**Description:** Mandu Island 특화 패턴. 컴파운드 Island, Island 간 이벤트 통신, slot-client 분리를 다룹니다.

## 4. Implementation Patterns (comp-pattern)

**Impact:** MEDIUM
**Description:** children 활용, Provider 경계 이해 등 구현 세부 사항. 올바른 패턴 적용으로 유연성을 확보합니다.
