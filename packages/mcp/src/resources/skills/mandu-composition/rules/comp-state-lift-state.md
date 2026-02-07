---
title: Lift State into Provider for Sibling Access
impact: HIGH
impactDescription: Enables state sharing without prop drilling
tags: composition, state, provider, lift-state
---

## Lift State into Provider for Sibling Access

**Impact: HIGH (Enables state sharing without prop drilling)**

형제 컴포넌트가 상태를 공유해야 할 때, 상태를 Provider로 끌어올리세요. Provider 경계 내의 모든 컴포넌트가 상태에 접근할 수 있습니다.

**Incorrect (prop drilling):**

```tsx
// ❌ 상태를 여러 단계로 전달
function ChatPage() {
  const [message, setMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  return (
    <div>
      <MessageList
        isTyping={isTyping}
        typingMessage={message}  // prop drilling
      />
      <Composer
        message={message}
        setMessage={setMessage}
        setIsTyping={setIsTyping}
      />
      <TypingIndicator isTyping={isTyping} />  // prop drilling
    </div>
  );
}
```

**Correct (Provider로 끌어올리기):**

```tsx
// ✅ Provider가 상태 관리
interface ChatContextValue {
  state: { message: string; isTyping: boolean };
  actions: { setMessage: (msg: string) => void; setIsTyping: (val: boolean) => void };
}

const ChatContext = createContext<ChatContextValue | null>(null);

function ChatProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  return (
    <ChatContext value={{
      state: { message, isTyping },
      actions: { setMessage, setIsTyping },
    }}>
      {children}
    </ChatContext>
  );
}

// 각 컴포넌트가 필요한 것만 가져감
function MessageList() {
  const { state } = use(ChatContext)!;
  return (
    <div>
      {messages.map(msg => <Message key={msg.id} {...msg} />)}
      {state.isTyping && <TypingPreview text={state.message} />}
    </div>
  );
}

function Composer() {
  const { state, actions } = use(ChatContext)!;
  return (
    <textarea
      value={state.message}
      onChange={(e) => {
        actions.setMessage(e.target.value);
        actions.setIsTyping(e.target.value.length > 0);
      }}
    />
  );
}

function TypingIndicator() {
  const { state } = use(ChatContext)!;
  if (!state.isTyping) return null;
  return <span>Someone is typing...</span>;
}
```

**사용:**

```tsx
function ChatPage() {
  return (
    <ChatProvider>
      <div>
        <MessageList />    {/* context에서 상태 읽음 */}
        <Composer />       {/* context에서 상태 수정 */}
        <TypingIndicator /> {/* context에서 상태 읽음 */}
      </div>
    </ChatProvider>
  );
}
```

## Provider 경계 이해하기

Provider 경계 내라면 시각적 위치와 무관하게 상태 접근 가능:

```tsx
<ChatProvider>
  <Dialog>
    {/* Dialog 내부 */}
    <Composer.Frame>
      <Composer.Input />
    </Composer.Frame>

    {/* Frame 외부지만 Provider 내부! */}
    <MessagePreview />  {/* ✅ context 접근 가능 */}

    <DialogActions>
      <SendButton />    {/* ✅ context 접근 가능 */}
    </DialogActions>
  </Dialog>
</ChatProvider>
```

## Mandu Island에서의 적용

```tsx
// app/chat/page.tsx
import { ChatIsland } from "./client";

export default function ChatPage({ data }) {
  return (
    <div>
      <h1>Chat</h1>
      {/* Island 내부에서 Provider로 상태 관리 */}
      <ChatIsland initialMessages={data.messages} />
    </div>
  );
}
```

Reference: [Lifting State Up](https://react.dev/learn/sharing-state-between-components)
