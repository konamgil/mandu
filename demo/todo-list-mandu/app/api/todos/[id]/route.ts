/**
 * Todo by ID API
 *
 * GET /api/todos/:id - 특정 Todo 조회
 * PUT /api/todos/:id - Todo 업데이트
 * DELETE /api/todos/:id - Todo 삭제
 */

import { Mandu } from "@mandujs/core";
import { todoService } from "../../../../src/server/application/todo.service";
import type { TodoDTO, UpdateTodoDTO } from "../../../../src/shared/contracts/todo";

function toDTO(todo: { id: string; title: string; completed: boolean; categoryId?: string; createdAt: Date; updatedAt: Date }): TodoDTO {
  return {
    ...todo,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
  };
}

export default Mandu.filling()
  .get((ctx) => {
    const { id } = ctx.params;
    const todo = todoService.getById(id);

    if (!todo) {
      return ctx.notFound("Todo not found");
    }

    return ctx.ok({ todo: toDTO(todo) });
  })
  .put(async (ctx) => {
    const { id } = ctx.params;
    const body = await ctx.body<UpdateTodoDTO>();

    const todo = todoService.update(id, body);

    if (!todo) {
      return ctx.notFound("Todo not found");
    }

    return ctx.ok({ todo: toDTO(todo) });
  })
  .delete((ctx) => {
    const { id } = ctx.params;
    const deleted = todoService.delete(id);

    if (!deleted) {
      return ctx.notFound("Todo not found");
    }

    return ctx.noContent();
  });
