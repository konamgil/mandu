/**
 * Category 도메인 모델
 */

export interface Category {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
}

export interface CreateCategoryInput {
  name: string;
  color?: string;
}

const DEFAULT_COLORS = [
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
];

let colorIndex = 0;

/**
 * Category 엔티티 생성 팩토리
 */
export function createCategory(input: CreateCategoryInput): Category {
  const color = input.color ?? DEFAULT_COLORS[colorIndex++ % DEFAULT_COLORS.length];
  return {
    id: crypto.randomUUID(),
    name: input.name,
    color,
    createdAt: new Date(),
  };
}
