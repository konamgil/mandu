import { createServer } from "net";

const DEFAULT_MAX_ATTEMPTS = 10;
// Max retries for the same port in Windows TIME_WAIT state (#125)
const TIME_WAIT_RETRY_ATTEMPTS = 3;
const TIME_WAIT_RETRY_DELAY_MS = 1000;

function isPortUsable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "EADDRINUSE" || code === "EACCES";
}

async function isPortAvailable(port: number, hostname?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", (error) => {
      if (isPortUsable(error)) {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    try {
      server.listen(port, hostname);
      server.unref();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Port availability check considering Windows TIME_WAIT state (#125)
 * Ports in TIME_WAIT may report EADDRINUSE but become available shortly after
 * Retries the same port a specified number of times before moving to next
 */
async function isPortAvailableWithRetry(
  port: number,
  hostname?: string
): Promise<boolean> {
  for (let i = 0; i < TIME_WAIT_RETRY_ATTEMPTS; i++) {
    const available = await isPortAvailable(port, hostname);
    if (available) return true;
    if (i < TIME_WAIT_RETRY_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, TIME_WAIT_RETRY_DELAY_MS));
    }
  }
  return false;
}

export async function resolveAvailablePort(
  startPort: number,
  options: {
    hostname?: string;
    offsets?: number[];
    maxAttempts?: number;
  } = {}
): Promise<{ port: number; attempts: number }> {
  const offsets = options.offsets && options.offsets.length > 0 ? options.offsets : [0];
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const isWindows = process.platform === "win32";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = startPort + attempt;
    if (candidate < 1 || candidate > 65535) {
      continue;
    }

    const targets = offsets
      .map((offset) => candidate + offset)
      .filter((port) => port >= 1 && port <= 65535);

    if (targets.length !== offsets.length) {
      continue;
    }

    // On Windows, apply TIME_WAIT retry only for the first port (attempt=0)
    const checkFn = (isWindows && attempt === 0)
      ? (port: number) => isPortAvailableWithRetry(port, options.hostname)
      : (port: number) => isPortAvailable(port, options.hostname);

    const results = await Promise.all(targets.map(checkFn));

    if (results.every(Boolean)) {
      return { port: candidate, attempts: attempt };
    }
  }

  throw new Error(`No available port found starting at ${startPort}`);
}
