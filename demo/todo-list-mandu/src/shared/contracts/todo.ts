/**
 * Todo API Contract
 *
 * 클라이언트-서버 간 공유되는 Todo 관련 타입 정의
 */

export interface TodoDTO {
  id: string;
  title: string;
  completed: boolean;
  categoryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoDTO {
  title: string;
  categoryId?: string;
}

export interface UpdateTodoDTO {
  title?: string;
  completed?: boolean;
  categoryId?: string;
}

export interface TodoStatsDTO {
  total: number;
  completed: number;
  pending: number;
  byCategory: Record<string, number>;
}

export type BulkActionDTO = "complete" | "incomplete" | "delete";

export interface BulkOperationDTO {
  ids: string[];
  action: BulkActionDTO;
}

export interface BulkResultDTO {
  affected: number;
  action: BulkActionDTO;
}

export interface TodoListResponse {
  todos: TodoDTO[];
}

export interface TodoResponse {
  todo: TodoDTO;
}

export interface ErrorResponse {
  error: string;
  message: string;
}
