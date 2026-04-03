import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn - Tailwind CSS class merge helper
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
