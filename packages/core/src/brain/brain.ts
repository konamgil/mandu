/**
 * Brain v0.1 - Main Brain Class
 *
 * Brain handles two responsibilities:
 * 1. Doctor (error recovery): Guard failure analysis + minimal patch suggestions
 * 2. Watch (error prevention): File change warnings (no blocking)
 *
 * Core Principles:
 * - Works without LLM (template-based), LLM only improves suggestion quality
 * - Never blocks operations - only warns and suggests
 * - Brain failure doesn't affect Core functionality (isolation)
 * - Auto-apply is disabled by default (experimental flag)
 */

import type {
  BrainConfig,
  BrainPolicy,
  EnvironmentInfo,
  AdapterStatus,
} from "./types";
import { DEFAULT_BRAIN_POLICY } from "./types";
import { type LLMAdapter, NoopAdapter } from "./adapters/base";
import { createOllamaAdapter } from "./adapters/ollama";
import { SessionMemory, getSessionMemory } from "./memory";
import {
  detectEnvironment,
  shouldEnableBrain,
  isolatedBrainExecution,
} from "./permissions";

/**
 * Brain status
 */
export interface BrainStatus {
  /** Whether Brain is enabled */
  enabled: boolean;
  /** LLM adapter status */
  adapter: AdapterStatus;
  /** Environment info */
  environment: EnvironmentInfo;
  /** Memory status */
  memory: {
    hasData: boolean;
    sessionDuration: number;
    idleTime: number;
  };
}

/**
 * Brain initialization options
 */
export interface BrainInitOptions {
  /** Custom configuration */
  config?: Partial<BrainConfig>;
  /** Custom policy */
  policy?: Partial<BrainPolicy>;
  /** Custom adapter (for testing) */
  adapter?: LLMAdapter;
}

/**
 * Main Brain class
 *
 * Singleton pattern - use Brain.getInstance() to get the instance.
 */
export class Brain {
  private static instance: Brain | null = null;

  private config: BrainConfig;
  private policy: BrainPolicy;
  private adapter: LLMAdapter;
  private memory: SessionMemory;
  private environment: EnvironmentInfo;
  private _enabled: boolean;
  private _initialized: boolean = false;

  private constructor(options: BrainInitOptions = {}) {
    // Detect environment
    this.environment = detectEnvironment();

    // Set up policy
    this.policy = {
      ...DEFAULT_BRAIN_POLICY,
      ...options.policy,
    };

    // Set up config
    this.config = {
      enabled: true,
      autoApply: false, // Disabled by default
      maxRetries: 3,
      watch: {
        debounceMs: 300,
      },
      ...options.config,
    };

    // Set up adapter
    if (options.adapter) {
      this.adapter = options.adapter;
    } else if (this.config.adapter) {
      this.adapter = createOllamaAdapter(this.config.adapter);
    } else {
      // Default: Ollama with default settings
      this.adapter = createOllamaAdapter();
    }

    // Get session memory
    this.memory = getSessionMemory();

    // Initially disabled until initialized
    this._enabled = false;
  }

  /**
   * Get the singleton Brain instance
   */
  static getInstance(options?: BrainInitOptions): Brain {
    if (!Brain.instance) {
      Brain.instance = new Brain(options);
    }
    return Brain.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    Brain.instance = null;
  }

  /**
   * Initialize Brain (async operations like checking adapter)
   */
  async initialize(): Promise<boolean> {
    if (this._initialized) {
      return this._enabled;
    }

    // Check adapter status
    const adapterStatus = await this.checkAdapterStatus();
    this.environment.modelAvailable = adapterStatus.available;

    // Determine if Brain should be enabled
    this._enabled = shouldEnableBrain(this.policy, this.environment);

    this._initialized = true;

    return this._enabled;
  }

  /**
   * Check if Brain is enabled
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Check if Brain has been initialized
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Get the current adapter
   */
  getAdapter(): LLMAdapter {
    return this.adapter;
  }

  /**
   * Get the session memory
   */
  getMemory(): SessionMemory {
    return this.memory;
  }

  /**
   * Check adapter status
   */
  async checkAdapterStatus(): Promise<AdapterStatus> {
    const { result } = await isolatedBrainExecution(
      () => this.adapter.checkStatus(),
      { available: false, model: null, error: "Check failed" }
    );
    return result;
  }

  /**
   * Get full Brain status
   */
  async getStatus(): Promise<BrainStatus> {
    const adapterStatus = await this.checkAdapterStatus();

    return {
      enabled: this._enabled,
      adapter: adapterStatus,
      environment: this.environment,
      memory: {
        hasData: this.memory.hasData(),
        sessionDuration: this.memory.getSessionDuration(),
        idleTime: this.memory.getIdleTime(),
      },
    };
  }

  /**
   * Check if LLM is available for enhanced analysis
   */
  async isLLMAvailable(): Promise<boolean> {
    const status = await this.checkAdapterStatus();
    return status.available;
  }

  /**
   * Execute a Brain operation with isolation
   *
   * Wraps operations to ensure Brain failures don't affect Core.
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback: T
  ): Promise<{ result: T; error?: Error }> {
    if (!this._enabled) {
      return { result: fallback };
    }

    return isolatedBrainExecution(operation, fallback);
  }

  /**
   * Generate a completion using the LLM adapter
   *
   * Returns empty string if LLM is not available.
   */
  async generate(prompt: string): Promise<string> {
    if (!this._enabled) {
      return "";
    }

    const { result } = await isolatedBrainExecution(
      () => this.adapter.generate(prompt),
      ""
    );

    return result;
  }

  /**
   * Disable Brain
   */
  disable(): void {
    this._enabled = false;
  }

  /**
   * Enable Brain (only if conditions allow)
   */
  enable(): boolean {
    const canEnable = shouldEnableBrain(this.policy, this.environment);
    if (canEnable) {
      this._enabled = true;
    }
    return this._enabled;
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<BrainConfig> {
    return { ...this.config };
  }

  /**
   * Get policy
   */
  getPolicy(): Readonly<BrainPolicy> {
    return { ...this.policy };
  }

  /**
   * Get environment info
   */
  getEnvironment(): Readonly<EnvironmentInfo> {
    return { ...this.environment };
  }
}

/**
 * Get or create the Brain instance
 *
 * Convenience function for accessing the singleton.
 */
export function getBrain(options?: BrainInitOptions): Brain {
  return Brain.getInstance(options);
}

/**
 * Initialize Brain and return its enabled status
 *
 * Convenience function for initialization.
 */
export async function initializeBrain(
  options?: BrainInitOptions
): Promise<boolean> {
  const brain = getBrain(options);
  return brain.initialize();
}

/**
 * Check if Brain is available and enabled
 *
 * Safe check that handles uninitialized state.
 */
export function isBrainEnabled(): boolean {
  try {
    const brain = Brain.getInstance();
    return brain.enabled;
  } catch {
    return false;
  }
}
