export default {
  server: { port: 3333 },
  guard: { realtime: false },
  build: {
    // Kitchen is a development-only surface and intentionally returns 404
    // from the production server. Keep its playground link out of SSG crawl.
    crawl: { exclude: ["/__kitchen"] },
  },
};
