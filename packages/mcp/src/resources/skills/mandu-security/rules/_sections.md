# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Authentication (sec-auth)

**Impact:** CRITICAL
**Description:** slot guard를 통한 인증 구현. 보호된 리소스에 대한 접근 제어의 첫 번째 방어선입니다.

## 2. Input Validation (sec-input)

**Impact:** CRITICAL
**Description:** 모든 사용자 입력의 검증과 살균. SQL Injection, Command Injection 등의 주입 공격 방어에 필수입니다.

## 3. CSRF/XSS Protection (sec-protect)

**Impact:** HIGH
**Description:** Cross-Site Request Forgery와 Cross-Site Scripting 방어. 웹 애플리케이션의 대표적인 취약점입니다.

## 4. Environment & Secrets (sec-env)

**Impact:** HIGH
**Description:** 환경 변수와 시크릿 관리. API 키, 데이터베이스 비밀번호 등 민감 정보 보호에 필수입니다.

## 5. Data Handling (sec-data)

**Impact:** MEDIUM
**Description:** 민감 데이터의 안전한 처리. 암호화, 해싱, 마스킹 등의 기법을 다룹니다.
