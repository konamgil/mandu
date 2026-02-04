#!/usr/bin/env bun

import { startServer } from "./server.js";
import path from "path";

// Start the MCP server
const args = process.argv.slice(2);
const globalMode = args.includes("--global");
const rootIndex = args.indexOf("--root");
const rootArg = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
const projectRoot = rootArg
  ? path.resolve(rootArg)
  : globalMode
  ? process.cwd()
  : undefined;

startServer(projectRoot).catch((error) => {
  console.error("Failed to start Mandu MCP server:", error);
  process.exit(1);
});
