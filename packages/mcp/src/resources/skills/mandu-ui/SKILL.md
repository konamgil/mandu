---
name: Mandu UI
description: UI component library integration and accessibility patterns
metadata:
  version: "1.0.0"
  author: mandu
globs:
  - "components/ui/**/*.tsx"
  - "app/**/client.tsx"
---

# Mandu UI Skill

Mandu Island 아키텍처에 UI 컴포넌트 라이브러리를 통합하는 가이드입니다.

## 핵심 원칙

1. **Headless First**: Radix UI 기반으로 동작과 스타일 분리
2. **Copy-Paste**: shadcn/ui 방식으로 소유권 유지
3. **Accessibility**: WCAG 2.1 AA 수준 준수
4. **Island 호환**: 클라이언트 컴포넌트로 올바르게 분리

## 권장 스택

```
Primitives:  Radix UI (headless, accessible)
Components:  shadcn/ui (copy-paste, customizable)
Icons:       Lucide React
Utilities:   clsx, tailwind-merge, cva
```

## 빠른 시작

### shadcn/ui 초기화

```bash
bunx shadcn-ui@latest init
```

```
✔ Would you like to use TypeScript? yes
✔ Which style would you like to use? Default
✔ Which color would you like to use as base? Slate
✔ Where is your global CSS file? app/globals.css
✔ Do you want to use CSS variables? yes
✔ Where is your tailwind.config located? tailwind.config.ts
✔ Configure import alias for components? @/components
✔ Configure import alias for utils? @/lib/utils
```

### 컴포넌트 추가

```bash
# 개별 컴포넌트
bunx shadcn-ui@latest add button
bunx shadcn-ui@latest add card
bunx shadcn-ui@latest add dialog

# 여러 컴포넌트
bunx shadcn-ui@latest add button card dialog input
```

## Island에서 사용

```tsx
// app/user-settings/client.tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function UserSettingsIsland() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Settings</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>User Settings</DialogTitle>
        </DialogHeader>
        {/* Settings form */}
      </DialogContent>
    </Dialog>
  );
}
```

## 폴더 구조

```
components/
├── ui/                    # shadcn/ui 컴포넌트
│   ├── button.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   └── ...
└── islands/               # 커스텀 Island 컴포넌트
    ├── user-menu.tsx
    └── ...
```

## 규칙 카테고리

| Category | Description | Rules |
|----------|-------------|-------|
| Library | 라이브러리 설정 | 2 |
| Accessibility | 접근성 패턴 | 2 |
| Integration | Island 통합 | 2 |

→ 세부 규칙은 `rules/` 폴더 참조
