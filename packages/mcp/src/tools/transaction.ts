import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  beginChange,
  commitChange,
  rollbackChange,
  getTransactionStatus,
  hasActiveTransaction,
} from "@mandujs/core";
import { acquireLock, releaseLock, checkLock } from "../tx-lock.js";

export const transactionToolDefinitions: Tool[] = [
  {
    name: "mandu.tx.begin",
    description:
      "Begin a new transaction. Creates a snapshot of the current spec state for safe rollback.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Description of the changes being made",
        },
        sessionId: {
          type: "string",
          description: "Caller session identifier for the concurrency lock",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.tx.commit",
    description: "Commit the current transaction, finalizing all changes",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        lockId: { type: "string", description: "Lock ID returned by mandu.tx.begin" },
      },
      required: [],
    },
  },
  {
    name: "mandu.tx.rollback",
    description: "Rollback the current transaction, restoring the previous state",
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        changeId: {
          type: "string",
          description: "Specific change ID to rollback (optional, defaults to active transaction)",
        },
        lockId: { type: "string", description: "Lock ID returned by mandu.tx.begin" },
      },
      required: [],
    },
  },
  {
    name: "mandu.tx.status",
    description: "Get the current transaction status",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function transactionTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.tx.begin": async (args: Record<string, unknown>) => {
      const { message, sessionId } = args as { message?: string; sessionId?: string };

      // Check if there's already an active transaction
      const isActive = await hasActiveTransaction(projectRoot);
      if (isActive) {
        const status = await getTransactionStatus(projectRoot);
        return {
          error: "Active transaction already exists",
          activeTransaction: status.change,
        };
      }

      // Acquire concurrency lock
      const lock = acquireLock(sessionId || "anonymous");
      if (!lock.success) {
        return { error: lock.error };
      }

      const change = await beginChange(projectRoot, {
        message: message || "MCP transaction",
      });

      return {
        success: true,
        changeId: change.id,
        lockId: lock.lockId,
        snapshotId: change.snapshotId,
        message: change.message,
        createdAt: change.createdAt,
        tip: "Use mandu.tx.commit to finalize or mandu.tx.rollback to revert changes. Pass lockId to subsequent calls.",
      };
    },

    "mandu.tx.commit": async (args: Record<string, unknown>) => {
      const { lockId } = args as { lockId?: string };
      const isActive = await hasActiveTransaction(projectRoot);
      if (!isActive) {
        return {
          error: "No active transaction to commit",
        };
      }

      const result = await commitChange(projectRoot);
      if (lockId) releaseLock(lockId);

      return {
        success: result.success,
        changeId: result.changeId,
        message: result.message,
      };
    },

    "mandu.tx.rollback": async (args: Record<string, unknown>) => {
      const { changeId, lockId } = args as { changeId?: string; lockId?: string };

      const isActive = await hasActiveTransaction(projectRoot);
      if (!isActive && !changeId) {
        return {
          error: "No active transaction to rollback. Provide a changeId to rollback a specific change.",
        };
      }

      const result = await rollbackChange(projectRoot, changeId);
      if (lockId) releaseLock(lockId);

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

    "mandu.tx.status": async () => {
      const { state, change } = await getTransactionStatus(projectRoot);
      const lock = checkLock();

      if (!state.active) {
        return {
          hasActiveTransaction: false,
          message: "No active transaction",
          lock,
        };
      }

      return {
        hasActiveTransaction: true,
        changeId: state.changeId,
        snapshotId: state.snapshotId,
        lock,
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

  // Backward-compatible aliases (deprecated)
  handlers["mandu_begin"] = handlers["mandu.tx.begin"];
  handlers["mandu_commit"] = handlers["mandu.tx.commit"];
  handlers["mandu_rollback"] = handlers["mandu.tx.rollback"];
  handlers["mandu_tx_status"] = handlers["mandu.tx.status"];

  return handlers;
}
