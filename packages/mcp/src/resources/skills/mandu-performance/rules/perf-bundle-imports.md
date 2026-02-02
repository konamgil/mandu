---
title: Import Directly, Avoid Barrel Files
impact: CRITICAL
impactDescription: 15-70% faster dev boot, 40% faster cold starts
tags: performance, bundle, imports, tree-shaking
---

## Import Directly, Avoid Barrel Files

**Impact: CRITICAL (15-70% faster dev boot, 40% faster cold starts)**

배럴 파일(index.ts에서 re-export)을 통하지 않고 소스 파일에서 직접 import하세요. 대형 라이브러리의 배럴 파일은 수천 개의 모듈을 로드합니다.

**Incorrect (전체 라이브러리 로드):**

```typescript
// app/page.tsx
import { Check, X, Menu } from "lucide-react";
// ❌ 1,583개 모듈 로드, 개발 시 ~2.8초 추가
// 런타임 비용: 콜드 스타트마다 200-800ms

import { Button, TextField } from "@mui/material";
// ❌ 2,225개 모듈 로드, 개발 시 ~4.2초 추가
```

**Correct (필요한 것만 로드):**

```typescript
// app/page.tsx
import Check from "lucide-react/dist/esm/icons/check";
import X from "lucide-react/dist/esm/icons/x";
import Menu from "lucide-react/dist/esm/icons/menu";
// ✅ 3개 모듈만 로드 (~2KB vs ~1MB)

import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
// ✅ 필요한 것만 로드
```

## Mandu 프로젝트에서의 적용

```typescript
// ❌ 잘못된 방식
import { useAuth, useUser, usePermissions } from "@/features/auth";

// ✅ 올바른 방식
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useUser } from "@/features/auth/hooks/useUser";
```

## 자체 배럴 파일 피하기

```typescript
// ❌ features/auth/index.ts (배럴 파일)
export * from "./hooks/useAuth";
export * from "./hooks/useUser";
export * from "./components/LoginForm";
export * from "./utils/validators";
// 모든 것을 로드하게 만듦

// ✅ 직접 import
import { useAuth } from "@/features/auth/hooks/useAuth";
```

## 영향받는 일반적인 라이브러리

- `lucide-react`, `react-icons`
- `@mui/material`, `@mui/icons-material`
- `@radix-ui/react-*`
- `lodash`, `date-fns`
- `@headlessui/react`

## 번들 분석

```bash
# 번들 크기 분석
bunx vite-bundle-visualizer
```

Reference: [How we optimized package imports in Next.js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)
