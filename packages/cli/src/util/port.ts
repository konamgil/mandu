import { createServer } from "net";

const DEFAULT_MAX_ATTEMPTS = 10;

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

    const results = await Promise.all(
      targets.map((port) => isPortAvailable(port, options.hostname))
    );

    if (results.every(Boolean)) {
      return { port: candidate, attempts: attempt };
    }
  }

  throw new Error(`No available port found starting at ${startPort}`);
}
