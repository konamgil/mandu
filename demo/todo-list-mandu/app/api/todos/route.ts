/**
 * Todos API
 *
 * GET /api/todos - 모든 Todo 조회
 * POST /api/todos - 새 Todo 생성
 */

import { Mandu } from "@mandujs/core";
import { todoService } from "../../../src/server/application/todo.service";
import type { TodoDTO, CreateTodoDTO } from "../../../src/shared/contracts/todo";

function toDTO(todo: { id: string; title: string; completed: boolean; categoryId?: string; createdAt: Date; updatedAt: Date }): TodoDTO {
  return {
    ...todo,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
  };
}

export default Mandu.filling()
  .get((ctx) => {
    const todos = todoService.getAll();
    return ctx.ok({ todos: todos.map(toDTO) });
  })
  .post(async (ctx) => {
    const body = await ctx.body<CreateTodoDTO>();

    if (!body.title?.trim()) {
      return ctx.error("Title is required");
    }

    const todo = todoService.create({
      title: body.title.trim(),
      categoryId: body.categoryId,
    });

    return ctx.created({ todo: toDTO(todo) });
  });
