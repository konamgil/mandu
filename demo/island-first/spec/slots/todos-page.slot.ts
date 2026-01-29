// 🥟 Mandu Filling - todos-page
// Pattern: /todos

import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({
      title: "할 일 목록",
      description: "Mandu Todos Demo",
    });
  });
