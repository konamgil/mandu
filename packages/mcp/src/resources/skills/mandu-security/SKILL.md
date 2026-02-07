---
name: mandu-security
description: |
  Security best practices for Mandu applications. Use when implementing
  authentication, authorization, input validation, or protecting against
  common vulnerabilities. Triggers on guard, auth, CSRF, XSS, or security tasks.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Security

Mandu 애플리케이션의 보안 모범 사례 가이드. slot guard를 통한 인증/인가, 입력 검증, CSRF/XSS 방어, 환경 변수 관리를 다룹니다.

## When to Apply

Reference these guidelines when:
- Implementing authentication in slots
- Adding authorization guards
- Validating user input
- Protecting against CSRF/XSS attacks
- Managing secrets and environment variables
- Handling sensitive data

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Authentication | CRITICAL | `sec-auth-` |
| 2 | Input Validation | CRITICAL | `sec-input-` |
| 3 | CSRF/XSS Protection | HIGH | `sec-protect-` |
| 4 | Environment & Secrets | HIGH | `sec-env-` |
| 5 | Data Handling | MEDIUM | `sec-data-` |

## Quick Reference

### 1. Authentication (CRITICAL)

- `sec-auth-guard` - Use guard() for authentication checks
- `sec-auth-session` - Secure session management
- `sec-auth-jwt` - JWT token handling best practices

### 2. Input Validation (CRITICAL)

- `sec-input-validate` - Always validate and sanitize input
- `sec-input-schema` - Use schema validation (Zod, etc.)
- `sec-input-escape` - Escape output to prevent injection

### 3. CSRF/XSS Protection (HIGH)

- `sec-protect-csrf` - CSRF token implementation
- `sec-protect-xss` - XSS prevention techniques
- `sec-protect-headers` - Security headers configuration

### 4. Environment & Secrets (HIGH)

- `sec-env-management` - Environment variable best practices
- `sec-env-no-expose` - Never expose secrets to client

### 5. Data Handling (MEDIUM)

- `sec-data-sanitize` - Sanitize data before storage
- `sec-data-encrypt` - Encrypt sensitive data

## Security Checklist

```
□ Authentication required for protected routes
□ Input validated on server side
□ Output escaped/sanitized
□ CSRF tokens for state-changing operations
□ Security headers configured
□ Secrets in environment variables only
□ No sensitive data in client bundles
```

## How to Use

Read individual rule files for detailed explanations:

```
rules/sec-auth-guard.md
rules/sec-input-validate.md
rules/sec-protect-csrf.md
```
