# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. File Naming (routes-naming)

**Impact:** CRITICAL
**Description:** page.tsx, route.ts, layout.tsx 등 특수 파일 명명 규칙. 잘못된 파일명은 라우트로 인식되지 않습니다.

## 2. Page Routes (routes-page)

**Impact:** HIGH
**Description:** page.tsx 컴포넌트 작성법. default export, metadata, props 접근 패턴을 다룹니다.

## 3. API Routes (routes-api)

**Impact:** HIGH
**Description:** route.ts에서 HTTP 메서드 함수 export. GET, POST, PUT, DELETE 핸들러 작성법입니다.

## 4. Dynamic Routes (routes-dynamic)

**Impact:** MEDIUM
**Description:** [id], [...slug], [[...slug]] 동적 세그먼트. URL 파라미터 캡처와 접근 방법을 다룹니다.

## 5. Layouts (routes-layout)

**Impact:** MEDIUM
**Description:** layout.tsx로 페이지 감싸기. 중첩 레이아웃과 공유 UI 패턴입니다.

## 6. Route Groups (routes-group)

**Impact:** LOW
**Description:** (group) 괄호로 URL에 영향 없이 폴더 구조 정리. 코드 구성에만 사용됩니다.
