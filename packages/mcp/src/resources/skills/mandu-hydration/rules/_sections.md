# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Client Directive (hydration-directive)

**Impact:** CRITICAL
**Description:** "use client" 지시어와 .client.tsx 파일 명명. 클라이언트 컴포넌트 식별에 필수입니다.

## 2. Island Structure (hydration-island)

**Impact:** HIGH
**Description:** Mandu.island() API로 Island 컴포넌트 구조화. setup/render 분리 패턴을 다룹니다.

## 3. Hydration Priority (hydration-priority)

**Impact:** MEDIUM
**Description:** immediate, visible, idle, interaction 우선순위. 초기 로드 성능 최적화에 중요합니다.

## 4. Data Flow (hydration-data)

**Impact:** MEDIUM
**Description:** useServerData, useIslandEvent를 통한 데이터 흐름. 서버-클라이언트, Island 간 통신입니다.

## 5. Error Handling (hydration-error)

**Impact:** LOW
**Description:** errorBoundary, loading 상태 처리. 사용자 경험 향상을 위한 폴백 UI입니다.
