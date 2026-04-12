/**
 * Transaction Lock — prevents concurrent project mutations from multiple AI agents.
 *
 * In-process singleton. If no lock exists, destructive tools work as before (backward compatible).
 * When a lock is held, only the holder (matching lockId) may execute destructive operations.
 */

export interface TxLock {
  lockId: string;
  sessionId: string;
  acquiredAt: number;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let activeLock: TxLock | null = null;

function isExpired(lock: TxLock): boolean {
  return Date.now() - lock.acquiredAt > lock.timeoutMs;
}

export function acquireLock(
  sessionId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): { success: boolean; lockId?: string; error?: string } {
  if (activeLock) {
    if (isExpired(activeLock)) {
      activeLock = null; // auto-release stale lock
    } else {
      return {
        success: false,
        error: `Lock held by session "${activeLock.sessionId}" since ${new Date(activeLock.acquiredAt).toISOString()}`,
      };
    }
  }
  const lockId = crypto.randomUUID();
  activeLock = { lockId, sessionId, acquiredAt: Date.now(), timeoutMs };
  return { success: true, lockId };
}

export function releaseLock(lockId: string): boolean {
  if (!activeLock || activeLock.lockId !== lockId) return false;
  activeLock = null;
  return true;
}

export function checkLock(): {
  locked: boolean;
  lockId?: string;
  sessionId?: string;
  acquiredAt?: number;
} {
  if (activeLock && isExpired(activeLock)) {
    activeLock = null;
  }
  if (!activeLock) return { locked: false };
  return {
    locked: true,
    lockId: activeLock.lockId,
    sessionId: activeLock.sessionId,
    acquiredAt: activeLock.acquiredAt,
  };
}

export function requireLock(lockId?: string): { allowed: boolean; error?: string } {
  if (!activeLock || isExpired(activeLock)) return { allowed: true };
  if (lockId === activeLock.lockId) return { allowed: true };
  return {
    allowed: false,
    error: `Project is locked by session "${activeLock.sessionId}". Provide a matching lockId or wait for expiry.`,
  };
}
