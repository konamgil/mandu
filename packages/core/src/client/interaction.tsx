import React, { type ButtonHTMLAttributes } from "react";
import { autoStableManduId } from "../runtime/stable-selector";

export interface ManduButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  manduId?: string;
}

/**
 * Mandu standard interaction Button.
 * Core guarantees data-mandu-id injection (best-effort, stable rule).
 */
export function ManduButton({ manduId, ...props }: ManduButtonProps) {
  const id = manduId ?? autoStableManduId("ManduButton");
  return <button data-mandu-id={id} {...props} />;
}

export interface ManduModalTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  manduId?: string;
  modal?: string;
}

/**
 * Skeleton modal trigger component.
 * ATE extractor can later recognize this signal.
 */
export function ManduModalTrigger({ manduId, modal, ...props }: ManduModalTriggerProps) {
  const id = manduId ?? autoStableManduId("ManduModalTrigger");
  return <button data-mandu-id={id} data-mandu-modal-trigger={modal ?? ""} {...props} />;
}
