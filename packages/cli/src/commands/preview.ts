/**
 * mandu preview - Build then start production server
 *
 * Convenience command that runs build followed by start.
 * Exits with error if build fails.
 */

export interface PreviewOptions {
  port?: number;
}

export async function preview(options: PreviewOptions = {}): Promise<void> {
  console.log("🥟 Mandu Preview\n");

  // Build
  console.log("📦 Step 1: Building...\n");
  const { build } = await import("./build");
  const buildOk = await build();

  if (!buildOk) {
    console.error("\n❌ Preview aborted: build failed");
    process.exit(1);
  }

  // Start production server
  console.log("\n🚀 Step 2: Starting production server...\n");
  const { start } = await import("./start");
  await start({ port: options.port });
}
