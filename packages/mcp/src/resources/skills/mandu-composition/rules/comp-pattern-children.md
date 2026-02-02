---
title: Use Children for Composition Over Render Props
impact: MEDIUM
impactDescription: Simpler API, better composition
tags: composition, children, render-props, pattern
---

## Use Children for Composition Over Render Props

**Impact: MEDIUM (Simpler API, better composition)**

`renderX` props 대신 `children`을 사용하여 컴포지션하세요. 더 선언적이고 유연합니다.

**Incorrect (render props):**

```tsx
// ❌ renderX props 패턴
function Modal({
  renderHeader,
  renderBody,
  renderFooter,
  renderCloseButton,
}: ModalProps) {
  return (
    <div className="modal">
      <div className="modal-header">
        {renderCloseButton?.()}
        {renderHeader?.()}
      </div>
      <div className="modal-body">
        {renderBody?.()}
      </div>
      <div className="modal-footer">
        {renderFooter?.()}
      </div>
    </div>
  );
}

// 사용 시 복잡함
<Modal
  renderHeader={() => <h2>Title</h2>}
  renderBody={() => <p>Content</p>}
  renderFooter={() => (
    <>
      <Button>Cancel</Button>
      <Button>Save</Button>
    </>
  )}
  renderCloseButton={() => <CloseButton />}
/>
```

**Correct (children + compound):**

```tsx
// ✅ children과 컴파운드 패턴
function Modal({ children }: { children: React.ReactNode }) {
  return <div className="modal">{children}</div>;
}

function ModalHeader({ children }: { children: React.ReactNode }) {
  return <div className="modal-header">{children}</div>;
}

function ModalBody({ children }: { children: React.ReactNode }) {
  return <div className="modal-body">{children}</div>;
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="modal-footer">{children}</div>;
}

function ModalClose({ onClose }: { onClose: () => void }) {
  return <button onClick={onClose} className="modal-close">×</button>;
}

export { Modal, ModalHeader, ModalBody, ModalFooter, ModalClose };
```

**사용:**

```tsx
// 선언적이고 명확함
<Modal>
  <ModalHeader>
    <ModalClose onClose={handleClose} />
    <h2>Title</h2>
  </ModalHeader>

  <ModalBody>
    <p>Content goes here</p>
  </ModalBody>

  <ModalFooter>
    <Button onClick={handleClose}>Cancel</Button>
    <Button onClick={handleSave}>Save</Button>
  </ModalFooter>
</Modal>
```

## 장점

| render props | children |
|--------------|----------|
| 숨겨진 구조 | 명시적 구조 |
| 함수 호출 문법 | JSX 문법 |
| 순서가 props에 의존 | 순서를 소비자가 제어 |
| 어떤 props가 있는지 봐야 함 | 자동완성 지원 |

## Mandu Island에서의 적용

```tsx
// ❌ 피해야 할 패턴
<FormIsland
  renderInput={(value, onChange) => <Input value={value} onChange={onChange} />}
  renderSubmit={(onSubmit) => <Button onClick={onSubmit}>Submit</Button>}
  renderError={(error) => <ErrorMessage error={error} />}
/>

// ✅ 권장 패턴
<Form.Provider>
  <Form.Frame>
    <Form.Input name="email" />
    <Form.Input name="password" type="password" />
    <Form.Error />
    <Form.Submit>Sign In</Form.Submit>
  </Form.Frame>
</Form.Provider>
```

## 언제 Render Props를 사용하나?

render props가 여전히 유용한 경우:
- 부모가 데이터를 제공하고 자식이 렌더링 방법을 결정 (예: virtualized list)
- 자식에게 상태를 노출해야 하는 headless 컴포넌트

```tsx
// Render props가 적합한 예: Virtualized List
<VirtualList
  items={items}
  itemHeight={50}
  renderItem={(item, index) => (
    <div key={item.id}>{item.name}</div>
  )}
/>
```

Reference: [Compound Components](https://kentcdodds.com/blog/compound-components-with-react-hooks)
