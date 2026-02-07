/**
 * Todo Bulk Operations API
 *
 * POST /api/todos/bulk - 벌크 작업 수행
 */

import { Mandu } from "@mandujs/core";
import { todoService } from "../../../../src/server/application/todo.service";
import type { BulkOperationDTO } from "../../../../src/shared/contracts/todo";

export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body<BulkOperationDTO>();

    if (!body.ids?.length) {
      return ctx.error("IDs are required");
    }

    if (!["complete", "incomplete", "delete"].includes(body.action)) {
      return ctx.error("Invalid action");
    }

    const result = todoService.bulkOperation(body.ids, body.action);
    return ctx.ok(result);
  });
