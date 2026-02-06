import type { ManduConfig } from "@mandujs/core";

const config: ManduConfig = {
  server: {
    port: 4000,
    streaming: true,
  },
  guard: {
    preset: "fsd",
    realtime: true,
  },
  fsRoutes: {
    routesDir: "app",
  },
};

export default config;
