/**
 * Mandu CLI - Brain Commands
 *
 * Commands for managing Brain (sLLM) configuration.
 * - brain setup: Configure sLLM settings
 * - brain status: Check current Brain status
 */

import {
  initializeBrain,
  getBrain,
  detectEnvironment,
  createOllamaAdapter,
  DEFAULT_OLLAMA_CONFIG,
} from "../../../core/src/index";

export interface BrainSetupOptions {
  /** Model name (default: llama3.2) */
  model?: string;
  /** Ollama server URL */
  url?: string;
  /** Skip model check */
  skipCheck?: boolean;
}

export interface BrainStatusOptions {
  /** Show verbose status */
  verbose?: boolean;
}

/**
 * Setup Brain (sLLM configuration)
 */
export async function brainSetup(options: BrainSetupOptions = {}): Promise<boolean> {
  const { model = DEFAULT_OLLAMA_CONFIG.model, url = DEFAULT_OLLAMA_CONFIG.baseUrl, skipCheck } = options;

  console.log("🧠 Mandu Brain Setup");
  console.log("─".repeat(40));
  console.log();

  // Create adapter with provided settings
  const adapter = createOllamaAdapter({
    model,
    baseUrl: url,
  });

  console.log(`📦 Model: ${model}`);
  console.log(`🔗 URL: ${url}`);
  console.log();

  if (!skipCheck) {
    console.log("🔍 Checking Ollama connection...");

    const status = await adapter.checkStatus();

    if (status.available) {
      console.log(`✅ Ollama is running`);
      console.log(`✅ Model '${status.model}' is available`);

      if (status.error) {
        console.log(`⚠️  ${status.error}`);
      }
    } else {
      console.log(`❌ ${status.error || "Ollama is not available"}`);
      console.log();
      console.log("💡 To fix this:");
      console.log("   1. Install Ollama: https://ollama.com");
      console.log("   2. Start Ollama: ollama serve");
      console.log(`   3. Pull the model: ollama pull ${model}`);
      console.log();
      console.log("   Or run with --skip-check to skip this verification.");
      return false;
    }
  }

  console.log();
  console.log("✅ Brain setup complete!");
  console.log();
  console.log("💡 Brain is now ready to assist with:");
  console.log("   • mandu doctor - Guard failure analysis + patch suggestions");
  console.log("   • mandu watch - Real-time file monitoring with warnings");
  console.log();
  console.log("ℹ️  Brain works without LLM too - LLM only improves suggestion quality.");

  return true;
}

/**
 * Check Brain status
 */
export async function brainStatus(options: BrainStatusOptions = {}): Promise<boolean> {
  const { verbose } = options;

  console.log("🧠 Mandu Brain Status");
  console.log("─".repeat(40));
  console.log();

  // Initialize Brain
  await initializeBrain();
  const brain = getBrain();
  const status = await brain.getStatus();

  // Environment info
  console.log("📊 Environment");
  console.log(`   CI: ${status.environment.isCI ? `Yes (${status.environment.ciProvider})` : "No"}`);
  console.log(`   Development: ${status.environment.isDevelopment ? "Yes" : "No"}`);
  console.log();

  // Brain status
  const brainIcon = status.enabled ? "🟢" : "🔴";
  console.log(`${brainIcon} Brain: ${status.enabled ? "Enabled" : "Disabled"}`);

  // Adapter status
  const adapterIcon = status.adapter.available ? "🟢" : "🔴";
  console.log(
    `${adapterIcon} LLM: ${status.adapter.available ? `Available (${status.adapter.model})` : "Not available"}`
  );

  if (status.adapter.error) {
    console.log(`   ⚠️  ${status.adapter.error}`);
  }

  // Memory status
  if (verbose) {
    console.log();
    console.log("📦 Memory");
    console.log(`   Has data: ${status.memory.hasData ? "Yes" : "No"}`);
    console.log(`   Session duration: ${status.memory.sessionDuration}s`);
    console.log(`   Idle time: ${status.memory.idleTime}s`);
  }

  console.log();

  // Recommendations
  if (!status.enabled) {
    console.log("💡 Brain is disabled because:");

    if (status.environment.isCI) {
      console.log("   • Running in CI environment (by design)");
    } else if (!status.adapter.available) {
      console.log("   • No LLM adapter available");
      console.log();
      console.log("   To enable Brain:");
      console.log("   1. Install Ollama: https://ollama.com");
      console.log("   2. Start Ollama: ollama serve");
      console.log("   3. Run: bunx mandu brain setup");
    }
  } else {
    console.log("✅ Brain is ready!");
    console.log();
    console.log("💡 Available commands:");
    console.log("   • bunx mandu doctor - Analyze Guard failures");
    console.log("   • bunx mandu watch - Real-time file monitoring");
  }

  return true;
}
