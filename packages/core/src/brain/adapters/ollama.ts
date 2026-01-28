/**
 * Brain v0.1 - Ollama LLM Adapter
 *
 * Default adapter for local sLLM via Ollama.
 * Uses official ollama npm package for reliable API integration.
 * Recommended models: ministral-3:3b, llama3.2, codellama, mistral
 */

import { Ollama } from "ollama";
import { BaseLLMAdapter } from "./base";
import type {
  AdapterConfig,
  AdapterStatus,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "../types";

/**
 * Default Ollama configuration
 *
 * Ministral 3B: 저사양 PC에서도 동작하는 경량 모델
 * - 2GB VRAM 이하에서도 CPU 모드로 동작
 * - 코드 분석/제안에 충분한 성능
 */
export const DEFAULT_OLLAMA_CONFIG: AdapterConfig = {
  baseUrl: "http://localhost:11434",
  model: "ministral-3:3b",  // Mistral's lightweight 3B model (3.0GB)
  timeout: 30000, // 30 seconds
};

/**
 * Ollama LLM Adapter
 *
 * Connects to a local Ollama instance for sLLM inference.
 * Falls back gracefully if Ollama is not available.
 */
export class OllamaAdapter extends BaseLLMAdapter {
  readonly name = "ollama";
  private client: Ollama;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({
      ...DEFAULT_OLLAMA_CONFIG,
      ...config,
    });

    this.client = new Ollama({
      host: this.baseUrl,
    });
  }

  /**
   * Check if Ollama is running and the model is available
   */
  async checkStatus(): Promise<AdapterStatus> {
    try {
      const response = await this.client.list();
      const models = response.models || [];

      // Check if configured model is available
      const modelAvailable = models.some(
        (m) =>
          m.name === this.config.model ||
          m.name.startsWith(`${this.config.model}:`)
      );

      if (!modelAvailable) {
        // Check if any model is available
        if (models.length > 0) {
          return {
            available: true,
            model: models[0].name,
            error: `Configured model '${this.config.model}' not found. Using '${models[0].name}' instead.`,
          };
        }

        return {
          available: false,
          model: null,
          error: `No models available. Run: ollama pull ${this.config.model}`,
        };
      }

      return {
        available: true,
        model: this.config.model,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Check for common connection errors
      if (
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("Unable to connect")
      ) {
        return {
          available: false,
          model: null,
          error: "Ollama is not running. Start with: ollama serve",
        };
      }

      return {
        available: false,
        model: null,
        error: `Ollama check failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Complete a chat conversation using Ollama's chat API
   */
  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {}
  ): Promise<CompletionResult> {
    const { temperature = 0.7, maxTokens = 2048 } = options;

    try {
      const response = await this.client.chat({
        model: this.config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      });

      return {
        content: response.message?.content || "",
        usage: {
          promptTokens: response.prompt_eval_count || 0,
          completionTokens: response.eval_count || 0,
          totalTokens:
            (response.prompt_eval_count || 0) + (response.eval_count || 0),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Ollama request timeout");
      }
      throw error;
    }
  }

  /**
   * Pull a model from Ollama registry with progress callback
   */
  async pullModel(
    modelName?: string,
    onProgress?: (status: string, completed?: number, total?: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    const model = modelName ?? this.config.model;

    try {
      const stream = await this.client.pull({
        model,
        stream: true,
      });

      for await (const progress of stream) {
        if (onProgress && progress.status) {
          onProgress(
            progress.status,
            progress.completed,
            progress.total
          );
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Check if Ollama server is reachable
   */
  async isServerRunning(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.list();
      return (response.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Generate embeddings for text
   */
  async embed(text: string, model?: string): Promise<number[] | null> {
    try {
      const response = await this.client.embed({
        model: model ?? this.config.model,
        input: text,
      });
      return response.embeddings?.[0] ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Create an Ollama adapter with optional configuration
 */
export function createOllamaAdapter(
  config?: Partial<AdapterConfig>
): OllamaAdapter {
  return new OllamaAdapter(config);
}
