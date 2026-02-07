# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Slot Testing (test-slot)

**Impact:** HIGH
**Description:** slot 핸들러의 단위 테스트와 통합 테스트. API 로직의 정확성 검증에 필수입니다.

## 2. Component Testing (test-component)

**Impact:** HIGH
**Description:** Island 컴포넌트의 렌더링과 인터랙션 테스트. UI 로직의 정확성 검증입니다.

## 3. E2E Testing (test-e2e)

**Impact:** MEDIUM
**Description:** Playwright를 사용한 End-to-End 테스트. 전체 사용자 플로우 검증입니다.

## 4. Mocking (test-mock)

**Impact:** MEDIUM
**Description:** 외부 의존성 모킹. 테스트 격리와 속도 향상을 위한 기법입니다.
