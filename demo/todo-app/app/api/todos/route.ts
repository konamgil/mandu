import { Mandu } from "@mandujs/core";
import { todoService } from "../../../server/domain/todo/todo.service";
import type { TodoFilter } from "../../../server/domain/todo/todo.types";

export default Mandu.filling()
  .get((ctx) => {
    const filter = (ctx.query.filter as TodoFilter) || "all";
    const todos = todoService.list(filter);
    const stats = todoService.stats();
    return ctx.ok({ todos, stats });
  })
  .post(async (ctx) => {
    const body = await ctx.body<{ title: string }>();

    if (!body.title?.trim()) {
      return ctx.error("Title is required");
    }

    const todo = todoService.create({ title: body.title });
    return ctx.created({ todo });
  })
  .delete((ctx) => {
    const cleared = todoService.clearCompleted();
    return ctx.ok({ cleared });
  });
