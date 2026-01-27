#!/usr/bin/env bun

import { startServer } from "./server.js";

// Start the MCP server
startServer().catch((error) => {
  console.error("Failed to start Mandu MCP server:", error);
  process.exit(1);
});
