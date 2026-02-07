import { createServer } from '@mandujs/core';

const server = await createServer({
  port: 3000,
  hostname: 'localhost',
});

console.log(`🥟 Mandu AI Chat Demo running at http://localhost:${server.port}`);
