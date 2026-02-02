import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn - Tailwind CSS 클래스 병합 유틸리티
 *
 * clsx로 조건부 클래스를 결합하고
 * tailwind-merge로 충돌하는 클래스를 스마트하게 병합
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-primary", className)
 * cn("text-sm", "text-lg") // → "text-lg" (충돌 해결)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
