/**
 * Brain v0.1 - Session Memory (Lightweight)
 *
 * Session-only memory for Brain operations.
 * No long-term persistence - avoids privacy/security/reproducibility issues.
 */

import type { BrainMemory } from "./types";
import type { GuardViolation } from "../guard/rules";
import type { RoutesManifest } from "../spec/schema";

/**
 * Create a new session memory
 */
export function createSessionMemory(): BrainMemory {
  const now = new Date();
  return {
    lastGuardResult: null,
    lastDiff: null,
    specSnapshot: null,
    sessionStart: now,
    lastActivity: now,
  };
}

/**
 * Session memory manager
 *
 * Provides in-memory storage for the current Brain session.
 * Memory is cleared when the process exits.
 */
export class SessionMemory {
  private memory: BrainMemory;

  constructor() {
    this.memory = createSessionMemory();
  }

  /**
   * Update the last Guard result
   */
  setGuardResult(violations: GuardViolation[]): void {
    this.memory.lastGuardResult = violations;
    this.memory.lastActivity = new Date();
  }

  /**
   * Get the last Guard result
   */
  getGuardResult(): GuardViolation[] | null {
    return this.memory.lastGuardResult;
  }

  /**
   * Update the last file diff
   */
  setDiff(diff: string): void {
    this.memory.lastDiff = diff;
    this.memory.lastActivity = new Date();
  }

  /**
   * Get the last file diff
   */
  getDiff(): string | null {
    return this.memory.lastDiff;
  }

  /**
   * Update the spec snapshot
   */
  setSpecSnapshot(manifest: RoutesManifest): void {
    this.memory.specSnapshot = manifest;
    this.memory.lastActivity = new Date();
  }

  /**
   * Get the spec snapshot
   */
  getSpecSnapshot(): RoutesManifest | null {
    return this.memory.specSnapshot;
  }

  /**
   * Get session duration in seconds
   */
  getSessionDuration(): number {
    const now = new Date();
    return Math.floor(
      (now.getTime() - this.memory.sessionStart.getTime()) / 1000
    );
  }

  /**
   * Get time since last activity in seconds
   */
  getIdleTime(): number {
    const now = new Date();
    return Math.floor(
      (now.getTime() - this.memory.lastActivity.getTime()) / 1000
    );
  }

  /**
   * Get full memory state (for debugging)
   */
  getState(): Readonly<BrainMemory> {
    return { ...this.memory };
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.memory = createSessionMemory();
  }

  /**
   * Check if memory has any data
   */
  hasData(): boolean {
    return (
      this.memory.lastGuardResult !== null ||
      this.memory.lastDiff !== null ||
      this.memory.specSnapshot !== null
    );
  }
}

/**
 * Global session memory instance
 * Single instance per process for simplicity
 */
let globalMemory: SessionMemory | null = null;

/**
 * Get or create the global session memory
 */
export function getSessionMemory(): SessionMemory {
  if (!globalMemory) {
    globalMemory = new SessionMemory();
  }
  return globalMemory;
}

/**
 * Reset the global session memory
 */
export function resetSessionMemory(): void {
  if (globalMemory) {
    globalMemory.clear();
  }
  globalMemory = null;
}
