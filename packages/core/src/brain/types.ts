/**
 * Brain v0.1 - Core Type Definitions
 *
 * Brain handles two responsibilities:
 * 1. Doctor (error recovery): Guard failure analysis + minimal patch suggestions
 * 2. Watch (error prevention): File change warnings (no blocking)
 */

import type { GuardViolation } from "../guard/rules";
import type { RoutesManifest } from "../spec/schema";

// ========== LLM Adapter Types ==========

/**
 * Message role for LLM conversations
 */
export type MessageRole = "system" | "user" | "assistant";

/**
 * Chat message structure
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
}

/**
 * LLM completion options
 */
export interface CompletionOptions {
  /** Temperature (0-1, lower = more deterministic) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Stop sequences */
  stop?: string[];
}

/**
 * LLM completion result
 */
export interface CompletionResult {
  content: string;
  /** Token usage (if available) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * LLM adapter status
 */
export interface AdapterStatus {
  available: boolean;
  model: string | null;
  error?: string;
}

/**
 * LLM adapter configuration
 */
export interface AdapterConfig {
  /** Base URL for the LLM API */
  baseUrl: string;
  /** Model name to use */
  model: string;
  /** Connection timeout in ms */
  timeout?: number;
}

// ========== Doctor Types ==========

/**
 * Patch suggestion from Doctor (discriminated union by type)
 *
 * type별로 필요한 필드가 타입 레벨에서 강제됨:
 * - add: content 필수
 * - modify: content 필수, line optional
 * - delete: file + confidence만 필요
 * - command: command 필수
 */
interface PatchSuggestionBase {
  /** Target file path */
  file: string;
  /** Description of the change */
  description: string;
  /** Confidence level (0-1) */
  confidence: number;
}

export type PatchSuggestion =
  | (PatchSuggestionBase & { type: "add"; content: string })
  | (PatchSuggestionBase & { type: "modify"; content: string; line?: number })
  | (PatchSuggestionBase & { type: "delete" })
  | (PatchSuggestionBase & { type: "command"; command: string });

/**
 * Doctor analysis result
 */
export interface DoctorAnalysis {
  /** Original violations */
  violations: GuardViolation[];
  /** Root cause summary */
  summary: string;
  /** Detailed explanation */
  explanation: string;
  /** Suggested patches */
  patches: PatchSuggestion[];
  /** Whether LLM was used for analysis */
  llmAssisted: boolean;
  /** Recommended next command */
  nextCommand?: string;
}

/**
 * Doctor options
 */
export interface DoctorOptions {
  /** Whether to use LLM for enhanced analysis */
  useLLM?: boolean;
  /** Maximum patches to suggest */
  maxPatches?: number;
  /** Minimum confidence for suggestions */
  minConfidence?: number;
}

// ========== Watch Types ==========

/**
 * Architecture rule for Watch
 */
export interface ArchRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable rule name */
  name: string;
  /** Rule description */
  description: string;
  /** File pattern to match (glob) */
  pattern: string;
  /** Rule action */
  action: "warn" | "error";
  /** Warning message template */
  message: string;
  /** Optional: file extension requirement */
  mustEndWith?: string;
  /** Optional: forbidden imports */
  forbiddenImports?: string[];
  /** Optional: required patterns in content */
  requiredPatterns?: RegExp[];
  /** Optional: exclude paths matching this pattern */
  excludePattern?: string;
  /** Recommended action for the agent */
  agentAction?: "regenerate" | "move" | "rename" | "remove_import" | "validate" | "none";
  /** MCP tool to execute */
  agentCommand?: string;
}

/**
 * Watch warning
 */
export interface WatchWarning {
  /** Rule that triggered the warning */
  ruleId: string;
  /** Affected file path */
  file: string;
  /** Warning message */
  message: string;
  /** Timestamp */
  timestamp: Date;
  /** Event type that triggered the warning */
  event: "create" | "modify" | "delete";
  /** Warning level */
  level?: "info" | "warn";
  /** Recommended action for the agent */
  agentAction?: string;
  /** MCP tool to execute */
  agentCommand?: string;
}

/**
 * Watch status
 */
export interface WatchStatus {
  /** Whether watching is active */
  active: boolean;
  /** Root directory being watched */
  rootDir: string | null;
  /** Number of files being watched */
  fileCount: number;
  /** Recent warnings */
  recentWarnings: WatchWarning[];
  /** Start time */
  startedAt: Date | null;
}

/**
 * Watch event handler
 */
export type WatchEventHandler = (warning: WatchWarning) => void;

// ========== Memory Types ==========

/**
 * Session memory (lightweight, no persistence)
 */
export interface BrainMemory {
  /** Last Guard check result */
  lastGuardResult: GuardViolation[] | null;
  /** Last file diff */
  lastDiff: string | null;
  /** Current spec snapshot */
  specSnapshot: RoutesManifest | null;
  /** Session start time */
  sessionStart: Date;
  /** Last activity time */
  lastActivity: Date;
}

// ========== Brain Configuration ==========

/**
 * Environment detection result
 */
export interface EnvironmentInfo {
  /** Is running in CI environment */
  isCI: boolean;
  /** CI provider name (if detected) */
  ciProvider?: string;
  /** Is development environment */
  isDevelopment: boolean;
  /** Detected model availability */
  modelAvailable: boolean;
}

/**
 * Brain configuration
 */
export interface BrainConfig {
  /** Whether Brain is enabled */
  enabled: boolean;
  /** LLM adapter configuration */
  adapter?: AdapterConfig;
  /** Auto-apply patches (default: false, experimental) */
  autoApply?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Watch configuration */
  watch?: {
    /** Extra commands to run on violations */
    extraCommands?: string[];
    /** Debounce delay in ms */
    debounceMs?: number;
  };
}

/**
 * Brain policy
 */
export interface BrainPolicy {
  /** Auto-detection mode: auto | always | never */
  enabled: "auto" | "always" | "never";
  /** CI environment handling */
  ci: boolean;
  /** Behavior when model is not available */
  localNoModel: "guidance-only" | "disabled";
  /** Behavior when model is available */
  localWithModel: boolean;
  /** Core isolation (Brain failure doesn't affect Core) */
  coreIsolation: boolean;
}

/**
 * Default Brain policy
 */
export const DEFAULT_BRAIN_POLICY: BrainPolicy = {
  enabled: "auto",
  ci: false,
  localNoModel: "guidance-only",
  localWithModel: true,
  coreIsolation: true,
};
