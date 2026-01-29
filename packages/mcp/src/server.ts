import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
  type Resource,
} from "@modelcontextprotocol/sdk/types.js";

import { specTools, specToolDefinitions } from "./tools/spec.js";
import { generateTools, generateToolDefinitions } from "./tools/generate.js";
import { transactionTools, transactionToolDefinitions } from "./tools/transaction.js";
import { historyTools, historyToolDefinitions } from "./tools/history.js";
import { guardTools, guardToolDefinitions } from "./tools/guard.js";
import { slotTools, slotToolDefinitions } from "./tools/slot.js";
import { hydrationTools, hydrationToolDefinitions } from "./tools/hydration.js";
import { contractTools, contractToolDefinitions } from "./tools/contract.js";
import { brainTools, brainToolDefinitions } from "./tools/brain.js";
import { resourceHandlers, resourceDefinitions } from "./resources/handlers.js";
import { findProjectRoot } from "./utils/project.js";
import { ActivityMonitor } from "./activity-monitor.js";
import { startWatcher } from "../../core/src/index.js";

export class ManduMcpServer {
  private server: Server;
  private projectRoot: string;
  private monitor: ActivityMonitor;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.monitor = new ActivityMonitor(projectRoot);
    this.server = new Server(
      {
        name: "mandu-mcp",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          logging: {},
        },
      }
    );

    this.registerToolHandlers();
    this.registerResourceHandlers();
  }

  private getAllToolDefinitions(): Tool[] {
    return [
      ...specToolDefinitions,
      ...generateToolDefinitions,
      ...transactionToolDefinitions,
      ...historyToolDefinitions,
      ...guardToolDefinitions,
      ...slotToolDefinitions,
      ...hydrationToolDefinitions,
      ...contractToolDefinitions,
      ...brainToolDefinitions,
    ];
  }

  private getAllToolHandlers(): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
    return {
      ...specTools(this.projectRoot),
      ...generateTools(this.projectRoot),
      ...transactionTools(this.projectRoot),
      ...historyTools(this.projectRoot),
      ...guardTools(this.projectRoot),
      ...slotTools(this.projectRoot),
      ...hydrationTools(this.projectRoot),
      ...contractTools(this.projectRoot),
      ...brainTools(this.projectRoot, this.server, this.monitor),
    };
  }

  private registerToolHandlers(): void {
    const toolHandlers = this.getAllToolHandlers();

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.getAllToolDefinitions(),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const handler = toolHandlers[name];
      if (!handler) {
        this.monitor.logTool(name, args, null, "Unknown tool");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
      }

      try {
        this.monitor.logTool(name, args);
        const result = await handler(args || {});
        this.monitor.logResult(name, result);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.monitor.logTool(name, args, null, msg);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: msg }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  private registerResourceHandlers(): void {
    const handlers = resourceHandlers(this.projectRoot);

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: resourceDefinitions,
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      const handler = handlers[uri];
      if (!handler) {
        // Try pattern matching for dynamic resources
        for (const [pattern, h] of Object.entries(handlers)) {
          if (pattern.includes("{") && matchResourcePattern(pattern, uri)) {
            const params = extractResourceParams(pattern, uri);
            const result = await h(params);
            return {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ error: `Unknown resource: ${uri}` }),
            },
          ],
        };
      }

      try {
        const result = await handler({});
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.monitor.start();

    // Auto-start watcher with activity monitor integration
    try {
      const watcher = await startWatcher({ rootDir: this.projectRoot });
      watcher.onWarning((warning) => {
        this.monitor.logWatch(
          warning.level || "warn",
          warning.ruleId,
          warning.file,
          warning.message,
        );
        // Also notify Claude Code via MCP
        this.server.sendLoggingMessage({
          level: "warning",
          logger: "mandu-watch",
          data: {
            type: "watch_warning",
            ruleId: warning.ruleId,
            file: warning.file,
            message: warning.message,
            event: warning.event,
          },
        }).catch(() => {});
      });
      this.monitor.logEvent("SYSTEM", "Watcher auto-started");
    } catch {
      this.monitor.logEvent("SYSTEM", "Watcher auto-start failed (non-critical)");
    }

    console.error(`Mandu MCP Server running for project: ${this.projectRoot}`);
  }
}

/**
 * Match a resource pattern like "mandu://slots/{routeId}" against a URI
 */
function matchResourcePattern(pattern: string, uri: string): boolean {
  const regexPattern = pattern.replace(/\{[^}]+\}/g, "([^/]+)");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(uri);
}

/**
 * Extract parameters from a URI based on a pattern
 */
function extractResourceParams(pattern: string, uri: string): Record<string, string> {
  const paramNames: string[] = [];
  const regexPattern = pattern.replace(/\{([^}]+)\}/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });

  const regex = new RegExp(`^${regexPattern}$`);
  const match = uri.match(regex);

  if (!match) return {};

  const params: Record<string, string> = {};
  paramNames.forEach((name, index) => {
    params[name] = match[index + 1];
  });

  return params;
}

/**
 * Create and start the MCP server
 */
export async function startServer(projectRoot?: string): Promise<void> {
  const root = projectRoot || (await findProjectRoot()) || process.cwd();
  const server = new ManduMcpServer(root);
  await server.run();
}
