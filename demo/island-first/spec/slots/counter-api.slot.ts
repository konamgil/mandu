import { Mandu } from "@mandujs/core";

let counter = 0;

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ count: counter });
  })
  .post(async (ctx) => {
    const body = await ctx.body();
    if (body.action === "increment") counter++;
    else if (body.action === "decrement") counter--;
    return ctx.ok({ count: counter });
  });
