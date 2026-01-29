import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({
      count: 0,
      title: "Counter Demo",
    });
  });
