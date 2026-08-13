---
title: Define Generic Context Interface for Dependency Injection
impact: HIGH
impactDescription: Enables dependency-injectable state across use-cases
tags: composition, context, state, typescript, dependency-injection
---

## Define Generic Context Interface for Dependency Injection

**Impact: HIGH (Enables dependency-injectable state across use-cases)**

컴포넌트 context를 위한 제네릭 인터페이스를 `state`, `actions`, `meta` 세 부분으로 정의하세요. 어떤 Provider든 이 인터페이스를 구현할 수 있어, 같은 UI 컴포넌트가 완전히 다른 상태 구현과 작동할 수 있습니다.

**핵심 원칙:** Lift state, compose internals, make state dependency-injectable.

**Incorrect (특정 상태 구현에 결합):**

```tsx
// ❌ 특정 훅에 강하게 결합
function ComposerInput() {
  const { input, setInput } = useChannelComposerState();
  return <TextInput value={input} onChangeText={setInput} />;
}
```

**Correct (제네릭 인터페이스로 의존성 주입):**

```tsx
// ✅ 어떤 Provider든 구현할 수 있는 제네릭 인터페이스
interface ComposerState {
  input: string;
  attachments: Attachment[];
  isSubmitting: boolean;
}

interface ComposerActions {
  update: (updater: (state: ComposerState) => ComposerState) => void;
  submit: () => void;
  addAttachment: (file: File) => void;
}

interface ComposerMeta {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  maxLength?: number;
}

interface ComposerContextValue {
  state: ComposerState;
  actions: ComposerActions;
  meta: ComposerMeta;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);
```

**UI 컴포넌트는 인터페이스만 소비:**

```tsx
function ComposerInput() {
  const {
    state,
    actions: { update },
    meta,
  } = use(ComposerContext)!;

  // 이 컴포넌트는 인터페이스를 구현한 어떤 Provider와도 작동
  return (
    <textarea
      ref={meta.inputRef}
      value={state.input}
      maxLength={meta.maxLength}
      onChange={(e) => update((s) => ({ ...s, input: e.target.value }))}
    />
  );
}
```

**서로 다른 Provider가 같은 인터페이스 구현:**

```tsx
// Provider A: 임시 폼을 위한 로컬 상태
function ForwardMessageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialState);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submit = useForwardMessage();

  return (
    <ComposerContext value={{
      state,
      actions: { update: setState, submit, addAttachment: ... },
      meta: { inputRef },
    }}>
      {children}
    </ComposerContext>
  );
}

// Provider B: 채널을 위한 전역 동기화 상태
function ChannelProvider({ channelId, children }: Props) {
  const { state, update, submit } = useGlobalChannel(channelId);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <ComposerContext value={{
      state,
      actions: { update, submit, addAttachment: ... },
      meta: { inputRef, maxLength: 2000 },
    }}>
      {children}
    </ComposerContext>
  );
}
```

**같은 UI가 두 Provider와 모두 작동:**

```tsx
// ForwardMessageProvider와 작동 (로컬 상태)
<ForwardMessageProvider>
  <Composer.Frame>
    <Composer.Input />
    <Composer.Submit />
  </Composer.Frame>
</ForwardMessageProvider>

// ChannelProvider와 작동 (전역 동기화 상태)
<ChannelProvider channelId="abc">
  <Composer.Frame>
    <Composer.Input />
    <Composer.Submit />
  </Composer.Frame>
</ChannelProvider>
```

## Mandu Island에서의 활용

```tsx
// Island 컴포넌트는 인터페이스만 알면 됨
// slot에서 어떤 Provider를 사용하든 같은 Island 재사용 가능

// spec/slots/forward.slot.ts → ForwardMessageProvider 사용
// spec/slots/channel.slot.ts → ChannelProvider 사용
// 둘 다 같은 Composer Island 컴포넌트 사용
```

UI는 재사용 가능한 조각들이고, 상태는 Provider가 주입합니다. Provider를 바꾸면 UI는 그대로!

Reference: [Context Interface Pattern](https://kentcdodds.com/blog/how-to-use-react-context-effectively)
