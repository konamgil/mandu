/**
 * Todo Stats API
 *
 * GET /api/todos/stats - Todo 통계 조회
 */

import { Mandu } from "@mandujs/core";
import { todoService } from "../../../../src/server/application/todo.service";

export default Mandu.filling()
  .get((ctx) => {
    const stats = todoService.getStats();
    return ctx.ok(stats);
  });
