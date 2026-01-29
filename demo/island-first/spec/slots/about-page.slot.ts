import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({
      title: "About",
      description: "Island-First Demo App",
    });
  });
