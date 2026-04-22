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

// Adapters (includes Ollama, OpenAI OAuth, Anthropic OAuth, and the
// `createBrainAdapter` / `resolveBrainAdapter` resolver — Issue #235).
export * from "./adapters";

// Credential store (OS keychain + filesystem fallback).
export {
  CredentialStore,
  getCredentialStore,
  setCredentialStore,
  filesystemBackend,
  macosBackend,
  linuxBackend,
  windowsBackend,
  pickPlatformBackend,
  type CredentialBackend,
  type StoredToken,
} from "./credentials";

// Consent prompt + cache (Issue #235).
export {
  ensureConsent,
  hasConsent,
  grantConsent,
  revokeConsent,
  fingerprintProject,
  consentFilePath,
  type ConsentContext,
  type ConsentEntry,
  type ConsentProvider,
  type ConsentPromptDeps,
} from "./consent";

// Redactor (pre-transmission secret scrubbing — Issue #235).
export {
  redact,
  redactSecrets,
  type RedactionHit,
  type RedactionKind,
  type RedactionResult,
} from "./redactor";

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
