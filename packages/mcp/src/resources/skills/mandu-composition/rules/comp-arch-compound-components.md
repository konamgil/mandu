---
title: Structure Islands as Compound Components
impact: HIGH
impactDescription: Enables flexible composition without prop drilling
tags: composition, compound, architecture, island
---

## Structure Islands as Compound Components

**Impact: HIGH (Enables flexible composition without prop drilling)**

복잡한 Island를 컴파운드 컴포넌트로 구조화하세요. 각 서브컴포넌트는 props가 아닌 context로 공유 상태에 접근합니다.

**Incorrect (모놀리식 컴포넌트):**

```tsx
// app/composer/client.tsx
"use client";

function ComposerIsland({
  renderHeader,
  renderFooter,
  renderActions,
  showAttachments,
  showFormatting,
  showEmojis,
}: Props) {
  const [input, setInput] = useState("");

  return (
    <form>
      {renderHeader?.()}
      <Input value={input} onChange={setInput} />
      {showAttachments && <Attachments />}
      {renderFooter ? (
        renderFooter()
      ) : (
        <Footer>
          {showFormatting && <Formatting />}
          {showEmojis && <Emojis />}
          {renderActions?.()}
        </Footer>
      )}
    </form>
  );
}
```

**Correct (컴파운드 Island):**

```tsx
// app/composer/client.tsx
"use client";

import { createContext, use, useState, useCallback } from "react";

// Context 정의
interface ComposerContextValue {
  state: { input: string; attachments: File[] };
  actions: {
    updateInput: (text: string) => void;
    submit: () => void;
  };
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

// Provider
function ComposerProvider({ children, onSubmit }: ProviderProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);

  const submit = useCallback(() => {
    onSubmit?.({ input, attachments });
    setInput("");
    setAttachments([]);
  }, [input, attachments, onSubmit]);

  return (
    <ComposerContext value={{
      state: { input, attachments },
      actions: { updateInput: setInput, submit },
    }}>
      {children}
    </ComposerContext>
  );
}

// 서브컴포넌트들
function ComposerFrame({ children }: { children: React.ReactNode }) {
  return <form onSubmit={(e) => e.preventDefault()}>{children}</form>;
}

function ComposerInput() {
  const { state, actions } = use(ComposerContext)!;
  return (
    <textarea
      value={state.input}
      onChange={(e) => actions.updateInput(e.target.value)}
      placeholder="Type a message..."
    />
  );
}

function ComposerSubmit() {
  const { actions } = use(ComposerContext)!;
  return <button onClick={actions.submit}>Send</button>;
}

function ComposerEmojis() {
  const { actions } = use(ComposerContext)!;
  return (
    <EmojiPicker onSelect={(emoji) => {
      actions.updateInput((prev) => prev + emoji);
    }} />
  );
}

// 컴파운드로 export
export const Composer = {
  Provider: ComposerProvider,
  Frame: ComposerFrame,
  Input: ComposerInput,
  Submit: ComposerSubmit,
  Emojis: ComposerEmojis,
  Attachments: ComposerAttachments,
  Formatting: ComposerFormatting,
};
```

**사용법:**

```tsx
// app/chat/page.tsx
import { Composer } from "../composer/client";

export default function ChatPage() {
  return (
    <div>
      <h1>Chat</h1>

      {/* 필요한 조각만 조합 */}
      <Composer.Provider onSubmit={handleSubmit}>
        <Composer.Frame>
          <Composer.Input />
          <footer>
            <Composer.Emojis />
            <Composer.Submit />
          </footer>
        </Composer.Frame>
      </Composer.Provider>
    </div>
  );
}
```

## 장점

- 소비자가 필요한 것만 명시적으로 조합
- 숨겨진 조건문 없음
- state/actions가 Provider에 의해 주입됨
- 같은 컴포넌트 구조를 다양한 구현과 재사용 가능

Reference: [Compound Components Pattern](https://www.patterns.dev/react/compound-pattern)
