/**
 * Brain v0.2 - Module Exports
 *
 * Brain handles three responsibilities:
 * 1. Doctor (error recovery): Guard failure analysis + minimal patch suggestions
 * 2. Watch (error prevention): File change warnings (no blocking)
 * 3. Architecture (structure enforcement): Project structure validation for coding agents
 */

// Types
export * from "./types";

// Adapters
export * from "./adapters";

// Permissions
export {
  detectEnvironment,
  shouldEnableBrain,
  isSafeForModification,
  isDangerousCommand,
  validatePatchSuggestion,
  filterSafePatchSuggestions,
  isolatedBrainExecution,
} from "./permissions";

// Memory
export {
  createSessionMemory,
  SessionMemory,
  getSessionMemory,
  resetSessionMemory,
} from "./memory";

// Brain core
export {
  Brain,
  getBrain,
  initializeBrain,
  isBrainEnabled,
  type BrainStatus,
  type BrainInitOptions,
} from "./brain";

// Doctor
export * from "./doctor";

// Architecture (v0.2)
export * from "./architecture";
