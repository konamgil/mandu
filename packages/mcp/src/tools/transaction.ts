import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  beginChange,
  commitChange,
  rollbackChange,
  getTransactionStatus,
  hasActiveTransaction,
} from "@mandujs/core";

export const transactionToolDefinitions: Tool[] = [
  {
    name: "mandu_begin",
    description:
      "Begin a new transaction. Creates a snapshot of the current spec state for safe rollback.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Description of the changes being made",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_commit",
    description: "Commit the current transaction, finalizing all changes",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_rollback",
    description: "Rollback the current transaction, restoring the previous state",
    inputSchema: {
      type: "object",
      properties: {
        changeId: {
          type: "string",
          description: "Specific change ID to rollback (optional, defaults to active transaction)",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_tx_status",
    description: "Get the current transaction status",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function transactionTools(projectRoot: string) {
  return {
    mandu_begin: async (args: Record<string, unknown>) => {
      const { message } = args as { message?: string };

      // Check if there's already an active transaction
      const isActive = await hasActiveTransaction(projectRoot);
      if (isActive) {
        const status = await getTransactionStatus(projectRoot);
        return {
          error: "Active transaction already exists",
          activeTransaction: status.change,
        };
      }

      const change = await beginChange(projectRoot, {
        message: message || "MCP transaction",
      });

      return {
        success: true,
        changeId: change.id,
        snapshotId: change.snapshotId,
        message: change.message,
        createdAt: change.createdAt,
        tip: "Use mandu_commit to finalize or mandu_rollback to revert changes",
      };
    },

    mandu_commit: async () => {
      const isActive = await hasActiveTransaction(projectRoot);
      if (!isActive) {
        return {
          error: "No active transaction to commit",
        };
      }

      const result = await commitChange(projectRoot);

      return {
        success: result.success,
        changeId: result.changeId,
        message: result.message,
      };
    },

    mandu_rollback: async (args: Record<string, unknown>) => {
      const { changeId } = args as { changeId?: string };

      const isActive = await hasActiveTransaction(projectRoot);
      if (!isActive && !changeId) {
        return {
          error: "No active transaction to rollback. Provide a changeId to rollback a specific change.",
        };
      }

      const result = await rollbackChange(projectRoot, changeId);

      return {
        success: result.success,
        changeId: result.changeId,
        restored: {
          filesRestored: result.restoreResult.restoredFiles.length,
          filesFailed: result.restoreResult.failedFiles.length,
          errors: result.restoreResult.errors,
        },
      };
    },

    mandu_tx_status: async () => {
      const { state, change } = await getTransactionStatus(projectRoot);

      if (!state.active) {
        return {
          hasActiveTransaction: false,
          message: "No active transaction",
        };
      }

      return {
        hasActiveTransaction: true,
        changeId: state.changeId,
        snapshotId: state.snapshotId,
        change: change
          ? {
              id: change.id,
              message: change.message,
              status: change.status,
              createdAt: change.createdAt,
            }
          : null,
      };
    },
  };
}
