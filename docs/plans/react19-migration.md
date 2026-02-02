# React 19 + React Compiler 마이그레이션 계획

## 요약

Mandu Framework의 React 19 및 React Compiler 도입 계획

**권장**: React 19로 마이그레이션 **적극 추천**
- Breaking changes 영향 **최소** (defaultProps, propTypes 미사용)
- Agent-Native 아키텍처와 Compiler 자동 최적화 **완벽 시너지**
- 성능 향상: 최대 12% 빠른 로드, 2.5x 빠른 인터랙션

---

## Phase 1: 현재 상태 분석 ✅

### 1.1 React API 사용 현황

| API | 사용 파일 | 영향도 |
|-----|----------|--------|
| `useCallback` | hooks.ts, Link.tsx | Compiler가 자동 최적화 → 제거 가능 |
| `useState` | hooks.ts, Link.tsx | 변경 없음 |
| `useEffect` | hooks.ts, Link.tsx | 변경 없음 |
| `useSyncExternalStore` | hooks.ts | 변경 없음 |
| `useRef` | Link.tsx | 변경 없음 |
| `hydrateRoot` | build.ts (runtime) | 변경 없음 |

### 1.2 Breaking Changes 체크리스트

| 항목 | Mandu 상태 | 조치 |
|------|-----------|------|
| `PropTypes` 제거 | ❌ 미사용 | 없음 |
| `defaultProps` (함수형) 제거 | ❌ 미사용 | 없음 |
| `string refs` 제거 | ❌ 미사용 | 없음 |
| `ref` as prop (forwardRef 불필요) | ✅ 호환 | 선택적 간소화 |
| `ReactDOM.render` 제거 | ❌ 미사용 (hydrateRoot 사용) | 없음 |

**결론**: Breaking changes 영향 **없음** → 즉시 마이그레이션 가능

---

## Phase 2: React Compiler 도입 전략

### 2.1 Agent-Native 시너지

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent-Native + Compiler                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AI Agent가 코드 생성    React Compiler가 자동 최적화       │
│         ↓                        ↓                          │
│  ┌─────────────┐          ┌─────────────┐                   │
│  │ Island 생성 │    →     │ 자동 memo   │                   │
│  │ (useMemo X) │          │ 자동 cache  │                   │
│  └─────────────┘          └─────────────┘                   │
│                                                             │
│  장점:                                                       │
│  • AI가 최적화 고민 불필요 (Compiler가 처리)                 │
│  • 코드 생성 단순화 → 에러 감소                             │
│  • 일관된 성능 보장                                         │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Island Hydration + Compiler

```typescript
// 현재: useCallback 수동 사용
export default Mandu.island<TodosData>({
  setup: (serverData) => {
    const [todos, setTodos] = useState(serverData.todos);
    const addTodo = useCallback(async (text: string) => {  // 수동 최적화
      // ...
    }, []);
    return { todos, addTodo };
  },
  render: ({ todos, addTodo }) => <TodoList todos={todos} onAdd={addTodo} />
});

// React 19 + Compiler: 자동 최적화
export default Mandu.island<TodosData>({
  setup: (serverData) => {
    const [todos, setTodos] = useState(serverData.todos);
    const addTodo = async (text: string) => {  // Compiler가 자동 memoize
      // ...
    };
    return { todos, addTodo };
  },
  render: ({ todos, addTodo }) => <TodoList todos={todos} onAdd={addTodo} />
});
```

### 2.3 새로운 React 19 Hooks 활용

| Hook | 용도 | Mandu 활용 |
|------|------|-----------|
| `useActionState` | 서버 액션 상태 | API 호출 상태 관리 |
| `useOptimistic` | 낙관적 UI | 실시간 피드백 |
| `useFormStatus` | 폼 제출 상태 | 로딩 인디케이터 |
| `use()` | Promise/Context 사용 | SSR 데이터 로딩 간소화 |

---

## Phase 3: 마이그레이션 로드맵

### 3.1 버전 전략

```
v0.9.x (현재)     → React 18.2+ (유지)
v0.10.0           → React 18.2 || 19.x (peerDep 범위 확장)
v1.0.0            → React 19.x (권장), 18.2+ (호환)
v1.1.0+           → React Compiler 기본 활성화
```

### 3.2 단계별 작업

#### Step 1: Dependencies 업데이트 (v0.10.0)
```json
// packages/core/package.json
{
  "peerDependencies": {
    "react": ">=18.2.0 || ^19.0.0",
    "react-dom": ">=18.2.0 || ^19.0.0"
  }
}

// packages/cli/templates/default/package.json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

#### Step 2: Compiler 설정 (v1.0.0)
```typescript
// packages/cli/src/bundler/bun-plugin-react-compiler.ts
import { reactCompiler } from 'babel-plugin-react-compiler';

export const reactCompilerPlugin: BunPlugin = {
  name: 'react-compiler',
  setup(build) {
    build.onLoad({ filter: /\.(tsx?|jsx?)$/ }, async (args) => {
      // Babel + React Compiler 변환
    });
  }
};
```

#### Step 3: 코드 간소화 (v1.0.0)
```typescript
// 제거 가능한 패턴 (Compiler가 자동 처리)
- useCallback(() => fn, [deps])  →  fn
- useMemo(() => value, [deps])   →  value
- React.memo(Component)          →  Component
```

#### Step 4: 새 API 도입 (v1.1.0)
```typescript
// packages/core/src/client/hooks.ts 추가
export function useServerAction<T>(action: () => Promise<T>) {
  const [state, formAction] = useActionState(action);
  return { state, submit: formAction };
}

export function useOptimisticUpdate<T>(
  currentValue: T,
  updateFn: (current: T, optimistic: T) => T
) {
  return useOptimistic(currentValue, updateFn);
}
```

---

## Phase 4: Template 업데이트

### 4.1 default 템플릿

```typescript
// templates/default/app/page.tsx
'use client';

import { useState } from 'react';

export default function Home() {
  const [count, setCount] = useState(0);

  // React Compiler가 자동 최적화 - useCallback 불필요
  const increment = () => setCount(c => c + 1);

  return (
    <main>
      <h1>🥟 Mandu + React 19</h1>
      <button onClick={increment}>Count: {count}</button>
    </main>
  );
}
```

### 4.2 Form 템플릿 (신규)

```typescript
// templates/with-forms/app/contact/page.tsx
'use client';

import { useActionState, useOptimistic } from 'react';

async function submitForm(prev: FormState, formData: FormData) {
  'use server';
  // 서버 액션 로직
}

export default function ContactForm() {
  const [state, action] = useActionState(submitForm, { status: 'idle' });
  const [optimistic, addOptimistic] = useOptimistic(state);

  return (
    <form action={action}>
      {/* Compiler가 모든 최적화 자동 처리 */}
    </form>
  );
}
```

---

## Phase 5: 테스트 전략

### 5.1 호환성 테스트 매트릭스

```
┌────────────────────────────────────────────────────┐
│              Test Matrix                           │
├──────────────┬──────────────┬──────────────────────┤
│ React Version│ Compiler     │ Test Status          │
├──────────────┼──────────────┼──────────────────────┤
│ 18.2.x       │ OFF          │ 기존 테스트 통과     │
│ 18.3.x       │ OFF          │ 기존 테스트 통과     │
│ 19.0.x       │ OFF          │ 새 테스트 추가       │
│ 19.0.x       │ ON           │ 성능 벤치마크 추가   │
└──────────────┴──────────────┴──────────────────────┘
```

### 5.2 새 테스트 케이스

```typescript
// packages/core/tests/react19.test.ts
import { describe, it, expect } from 'vitest';

describe('React 19 Compatibility', () => {
  it('should work with ref as prop', async () => {
    // forwardRef 없이 ref 전달 테스트
  });

  it('should support useActionState', async () => {
    // 서버 액션 상태 관리 테스트
  });

  it('should support useOptimistic', async () => {
    // 낙관적 업데이트 테스트
  });
});

describe('React Compiler', () => {
  it('should auto-memoize callbacks', async () => {
    // 콜백 자동 메모이제이션 검증
  });

  it('should preserve referential equality', async () => {
    // 참조 동등성 유지 검증
  });
});
```

---

## Phase 6: 문서화

### 6.1 업데이트할 문서

| 문서 | 변경 사항 |
|------|----------|
| README.md | React 19 지원 명시 |
| Quick Start | React 19 기본 사용 |
| Island Guide | Compiler 최적화 설명 |
| Migration Guide | 18 → 19 마이그레이션 |

### 6.2 새 문서

- `docs/react-compiler.md` - Compiler 설정 및 최적화 가이드
- `docs/server-actions.md` - React 19 Server Actions 통합
- `docs/migration-react19.md` - 마이그레이션 체크리스트

---

## 일정 (예상)

| 마일스톤 | 버전 | 내용 |
|----------|------|------|
| M1 | v0.10.0 | peerDep 범위 확장, 호환성 테스트 |
| M2 | v0.11.0 | Template React 19 기본 적용 |
| M3 | v1.0.0 | Compiler 옵트인 지원 |
| M4 | v1.1.0 | 새 Hooks 래퍼 API 제공 |
| M5 | v1.2.0 | Compiler 기본 활성화 |

---

## 결론

### 장점

1. **Agent-Native 시너지**: AI가 생성한 코드도 자동 최적화
2. **코드 단순화**: useCallback/useMemo 제거 → 보일러플레이트 감소
3. **성능 향상**: 자동 메모이제이션으로 일관된 성능
4. **미래 대비**: React 생태계 최신 기능 지원

### 위험 요소

1. **Bun + Compiler 호환성**: babel-plugin 의존성 추가
2. **빌드 시간 증가**: Compiler 변환 오버헤드
3. **디버깅 복잡성**: 자동 최적화로 인한 추적 어려움

### 권장 액션

1. **즉시**: peerDependencies 범위 확장 (React 19 호환)
2. **단기**: Template에 React 19 + @types/react@19 적용
3. **중기**: Compiler 옵트인 지원 추가
4. **장기**: Compiler 기본 활성화 및 레거시 패턴 제거
