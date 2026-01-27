// Types
export type {
  ChangeRecord,
  Snapshot,
  TransactionState,
  HistoryConfig,
  RestoreResult,
  CommitResult,
  RollbackResult,
  BeginChangeOptions,
} from "./types";

export { DEFAULT_HISTORY_CONFIG } from "./types";

// Integrity
export { computeFileHash, collectFileHashes, collectFilePaths } from "./integrity";

// Snapshot
export {
  createSnapshot,
  readSnapshot,
  writeSnapshot,
  readSnapshotById,
  restoreSnapshot,
  deleteSnapshot,
  listSnapshotIds,
} from "./snapshot";

// Transaction
export {
  beginChange,
  commitChange,
  rollbackChange,
  hasActiveTransaction,
  getActiveTransaction,
  getTransactionStatus,
} from "./transaction";

// History
export { listChanges, getChange, pruneHistory, loadHistoryConfig, getChangeStats } from "./history";
