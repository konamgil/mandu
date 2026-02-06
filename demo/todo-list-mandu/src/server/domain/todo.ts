/**
 * Todo 도메인 모델
 */

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  categoryId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTodoInput {
  title: string;
  categoryId?: string;
}

export interface UpdateTodoInput {
  title?: string;
  completed?: boolean;
  categoryId?: string;
}

export interface TodoStats {
  total: number;
  completed: number;
  pending: number;
  byCategory: Record<string, number>;
}

export type BulkAction = "complete" | "incomplete" | "delete";

export interface BulkOperationInput {
  ids: string[];
  action: BulkAction;
}

export interface BulkOperationResult {
  affected: number;
  action: BulkAction;
}

/**
 * Todo 엔티티 생성 팩토리
 */
export function createTodo(input: CreateTodoInput): Todo {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    title: input.title,
    completed: false,
    categoryId: input.categoryId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Todo 엔티티 업데이트
 */
export function updateTodo(todo: Todo, input: UpdateTodoInput): Todo {
  return {
    ...todo,
    ...input,
    updatedAt: new Date(),
  };
}
