/**
 * Mandu <Form> Component
 * Progressive Enhancement: JS 없으면 일반 HTML form, JS 있으면 fetch 기반 제출
 */

import { useState, useCallback, useRef, type FormEvent, type ReactNode } from "react";
import { submitAction, type ActionResult } from "./router";

export interface FormState {
  submitting: boolean;
  error: string | null;
}

export interface FormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "action" | "children"> {
  /** 제출 대상 URL */
  action: string;
  /** Action 이름 (서버의 filling.action(name)과 매칭) */
  actionName?: string;
  /** HTTP 메서드 */
  method?: "post" | "put" | "patch" | "delete";
  /** JS에서 fetch 방식으로 전환 (기본: true, false면 일반 HTML form 제출) */
  enhance?: boolean;
  /** Action 성공 후 콜백 */
  onActionSuccess?: (result: ActionResult) => void;
  /** Action 실패 후 콜백 */
  onActionError?: (error: Error) => void;
  /** render props 또는 일반 children */
  children: ReactNode | ((state: FormState) => ReactNode);
}

/**
 * Progressive Enhancement Form 컴포넌트
 *
 * @example
 * ```tsx
 * <Form action="/api/todos" actionName="create">
 *   <input name="title" required />
 *   <button type="submit">추가</button>
 * </Form>
 *
 * // render props로 제출 상태 접근
 * <Form action="/api/todos" actionName="create">
 *   {({ submitting, error }) => (
 *     <>
 *       <input name="title" required />
 *       <button type="submit" disabled={submitting}>
 *         {submitting ? "처리 중..." : "추가"}
 *       </button>
 *       {error && <p>{error}</p>}
 *     </>
 *   )}
 * </Form>
 * ```
 */
export function Form({
  action,
  actionName = "default",
  method = "post",
  enhance = true,
  onActionSuccess,
  onActionError,
  children,
  ...rest
}: FormProps) {
  const [state, setState] = useState<FormState>({ submitting: false, error: null });
  const submittingRef = useRef(false);

  const handleSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    if (!enhance) return;
    if (submittingRef.current) return; // 이중 제출 방지

    e.preventDefault();
    submittingRef.current = true;
    setState({ submitting: true, error: null });

    try {
      const formData = new FormData(e.currentTarget);
      const result = await submitAction(action, formData, actionName, method);

      if (result.ok) {
        setState({ submitting: false, error: null });
        onActionSuccess?.(result);
      } else {
        const message = "요청이 실패했습니다.";
        setState({ submitting: false, error: message });
        onActionError?.(new Error(message));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "요청 실패";
      setState({ submitting: false, error: message });
      onActionError?.(error instanceof Error ? error : new Error(message));
    } finally {
      submittingRef.current = false;
    }
  }, [action, actionName, enhance, method, onActionSuccess, onActionError]);

  return (
    <form action={action} method={method} onSubmit={handleSubmit} {...rest}>
      <input type="hidden" name="_action" value={actionName} />
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}
