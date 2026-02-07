# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Layer Rules (guard-layer)

**Impact:** CRITICAL
**Description:** 레이어 의존성 방향 규칙. 상위→하위만 허용, 역방향 import 금지. 아키텍처 무결성의 핵심입니다.

## 2. Presets (guard-preset)

**Impact:** HIGH
**Description:** mandu, fsd, clean, hexagonal 프리셋 선택. 프로젝트 유형에 맞는 아키텍처 템플릿입니다.

## 3. Validation (guard-validate)

**Impact:** HIGH
**Description:** import 경로, 파일 위치, 네이밍 검증. 실시간 위반 감지와 리포팅입니다.

## 4. Configuration (guard-config)

**Impact:** MEDIUM
**Description:** 규칙 severity 설정, ignore 패턴. 프로젝트 특성에 맞게 가드를 커스터마이징합니다.

## 5. CI Integration (guard-ci)

**Impact:** MEDIUM
**Description:** --ci 플래그, exit code, 리포트 생성. 자동화된 아키텍처 검증 파이프라인입니다.

## 6. Auto Fix (guard-fix)

**Impact:** LOW
**Description:** --auto-correct 옵션. 일부 위반의 자동 수정 기능입니다.
