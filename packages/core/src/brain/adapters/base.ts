/**
 * Brain v0.1 - Base LLM Adapter Interface
 *
 * Defines the interface for LLM adapters.
 * Brain works without LLM (template-based), LLM only improves suggestion quality.
 */

import type {
  AdapterConfig,
  AdapterStatus,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "../types";

/**
 * Base LLM Adapter Interface
 *
 * Implementations:
 * - OllamaAdapter: Local sLLM via Ollama
 * - (Future) OpenAIAdapter, AnthropicAdapter, etc.
 */
export interface LLMAdapter {
  /**
   * Adapter name (e.g., "ollama", "openai")
   */
  readonly name: string;

  /**
   * Check if the adapter is available and configured
   */
  checkStatus(): Promise<AdapterStatus>;

  /**
   * Complete a chat conversation
   */
  complete(
    messages: ChatMessage[],
    options?: CompletionOptions
  ): Promise<CompletionResult>;

  /**
   * Generate a simple completion (convenience method)
   */
  generate(prompt: string, options?: CompletionOptions): Promise<string>;
}

/**
 * Base adapter implementation with common functionality
 */
export abstract class BaseLLMAdapter implements LLMAdapter {
  abstract readonly name: string;
  protected config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  abstract checkStatus(): Promise<AdapterStatus>;
  abstract complete(
    messages: ChatMessage[],
    options?: CompletionOptions
  ): Promise<CompletionResult>;

  /**
   * Simple generation (wraps complete with a single user message)
   */
  async generate(prompt: string, options?: CompletionOptions): Promise<string> {
    const result = await this.complete(
      [{ role: "user", content: prompt }],
      options
    );
    return result.content;
  }

  /**
   * Get the configured model name
   */
  get model(): string {
    return this.config.model;
  }

  /**
   * Get the configured base URL
   */
  get baseUrl(): string {
    return this.config.baseUrl;
  }
}

/**
 * No-op adapter for when LLM is not available
 * Returns empty results, allowing Brain to fall back to template-based analysis
 */
export class NoopAdapter implements LLMAdapter {
  readonly name = "noop";

  async checkStatus(): Promise<AdapterStatus> {
    return {
      available: false,
      model: null,
      error: "No LLM adapter configured",
    };
  }

  async complete(): Promise<CompletionResult> {
    return {
      content: "",
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }

  async generate(): Promise<string> {
    return "";
  }
}
