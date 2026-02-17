import { createServer } from "net";

const DEFAULT_MAX_ATTEMPTS = 10;
// Windows TIME_WAIT 상태에서 같은 포트를 재시도하는 최대 횟수 (#125)
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
 * Windows TIME_WAIT 상태를 고려한 포트 가용성 체크 (#125)
 * EADDRINUSE이지만 TIME_WAIT 중인 포트는 잠시 후 사용 가능해질 수 있음
 * → 같은 포트를 지정 횟수만큼 재시도 후 다음 포트로 이동
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

    // Windows에서는 최초 포트(attempt=0)에 한해 TIME_WAIT 재시도 적용
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
