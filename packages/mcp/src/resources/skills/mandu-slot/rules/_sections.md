# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Basic Structure (slot-basic)

**Impact:** CRITICAL
**Description:** Mandu.filling()을 default export로 사용하는 기본 구조. 이것 없이는 slot이 작동하지 않습니다.

## 2. Context Response (slot-ctx)

**Impact:** HIGH
**Description:** ctx 객체의 응답 메서드 (ok, created, error 등) 사용법. 올바른 HTTP 상태 코드 반환에 필수적입니다.

## 3. Guard & Auth (slot-guard)

**Impact:** HIGH
**Description:** guard()를 사용한 인증/인가 패턴. 보안이 필요한 API 엔드포인트에 필수입니다.

## 4. HTTP Methods (slot-http)

**Impact:** HIGH
**Description:** get(), post(), put(), patch(), delete() 메서드 체이닝. RESTful API 설계의 핵심입니다.

## 5. Lifecycle Hooks (slot-lifecycle)

**Impact:** MEDIUM
**Description:** onRequest, beforeHandle, afterHandle, afterResponse 훅. 로깅, 타이밍, 변환에 사용됩니다.

## 6. Request Data (slot-request)

**Impact:** MEDIUM
**Description:** ctx.body(), ctx.params, ctx.query, ctx.headers 접근법. 요청 데이터 처리에 필요합니다.
