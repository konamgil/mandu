import { Mandu } from "@mandujs/core";
import { todoService } from "../../../../server/domain/todo/todo.service";

export default Mandu.filling()
  .get((ctx) => {
    const todo = todoService.getById(ctx.params.id);
    if (!todo) return ctx.notFound("Todo not found");
    return ctx.ok({ todo });
  })
  .put(async (ctx) => {
    const body = await ctx.body<{ title?: string; completed?: boolean }>();
    const todo = todoService.update(ctx.params.id, body);
    if (!todo) return ctx.notFound("Todo not found");
    return ctx.ok({ todo });
  })
  .delete((ctx) => {
    const deleted = todoService.delete(ctx.params.id);
    if (!deleted) return ctx.notFound("Todo not found");
    return ctx.noContent();
  });
