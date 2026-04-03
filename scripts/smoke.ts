import fs from "fs/promises";
import path from "path";
import { createServer } from "node:net";

const repoRoot = path.resolve(import.meta.dir, "..");
const cliEntry = path.join(repoRoot, "packages", "cli", "src", "main.ts");
const projectName = "mandu-smoke-app";

interface CompletedCommand {
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunningCommand {
  args: string[];
  cwd: string;
  proc: Bun.Subprocess<"pipe", "pipe", "inherit">;
  stdoutPromise: Promise<string>;
  stderrPromise: Promise<string>;
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runCommand(
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<CompletedCommand> {
  const proc = Bun.spawn(args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  const result: CompletedCommand = {
    args,
    cwd,
    exitCode,
    stdout,
    stderr,
  };

  if (exitCode !== 0) {
    throw new Error(formatCommandFailure("Command failed", result));
  }

  return result;
}

function startCommand(
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): RunningCommand {
  const proc = Bun.spawn(args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    args,
    cwd,
    proc,
    stdoutPromise: readStream(proc.stdout),
    stderrPromise: readStream(proc.stderr),
  };
}

async function stopCommand(command: RunningCommand): Promise<CompletedCommand> {
  try {
    command.proc.kill("SIGTERM");
  } catch {
    // ignore
  }

  const exited = await Promise.race([
    command.proc.exited,
    Bun.sleep(5000).then(() => -1),
  ]);

  if (exited === -1) {
    try {
      command.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    command.stdoutPromise,
    command.stderrPromise,
    command.proc.exited,
  ]);

  return {
    args: command.args,
    cwd: command.cwd,
    exitCode,
    stdout,
    stderr,
  };
}

function formatCommandFailure(prefix: string, result: CompletedCommand): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  return [
    prefix,
    `cwd: ${result.cwd}`,
    `command: ${result.args.join(" ")}`,
    `exitCode: ${result.exitCode}`,
    stdout ? `stdout:\n${stdout}` : "stdout:\n<empty>",
    stderr ? `stderr:\n${stderr}` : "stderr:\n<empty>",
  ].join("\n\n");
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close();
        reject(new Error("Failed to resolve a free port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttp(
  url: string,
  label: string,
  assertResponse: (response: Response) => Promise<void>,
  timeoutMs = 60_000
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      await assertResponse(response);
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(500);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} did not become ready in ${timeoutMs}ms: ${reason}`);
}

async function assertHealthEndpoint(url: string): Promise<void> {
  await waitForHttp(
    url,
    "health endpoint",
    async (response) => {
      if (!response.ok) {
        throw new Error(`Expected 200 response, got ${response.status}`);
      }

      const data = await response.json() as {
        status?: string;
        framework?: string;
      };

      if (data.status !== "ok") {
        throw new Error(`Expected status=ok, got ${JSON.stringify(data)}`);
      }

      if (data.framework !== "Mandu") {
        throw new Error(`Expected framework=Mandu, got ${JSON.stringify(data)}`);
      }
    }
  );
}

async function assertHomePage(url: string): Promise<void> {
  await waitForHttp(
    url,
    "home page",
    async (response) => {
      if (!response.ok) {
        throw new Error(`Expected 200 response, got ${response.status}`);
      }

      const html = await response.text();
      if (!html.includes("Mandu")) {
        throw new Error("Expected home page HTML to include 'Mandu'");
      }
    }
  );
}

async function stripManduPackageDeps(projectDir: string): Promise<void> {
  const packageJsonPath = path.join(projectDir, "package.json");
  const content = await fs.readFile(packageJsonPath, "utf-8");
  const pkg = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  for (const sectionName of ["dependencies", "devDependencies"] as const) {
    const section = pkg[sectionName];
    if (!section) continue;

    for (const dependencyName of Object.keys(section)) {
      if (dependencyName.startsWith("@mandujs/")) {
        delete section[dependencyName];
      }
    }
  }

  await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function main(): Promise<void> {
  const smokeRoot = path.join(repoRoot, ".smoke");
  await fs.mkdir(smokeRoot, { recursive: true });
  const smokeRunRoot = await fs.mkdtemp(path.join(smokeRoot, "run-"));
  const projectDir = path.join(smokeRunRoot, projectName);
  let cleanupTempDir = true;

  try {
    console.log("1/5 init");
    await runCommand(
      [
        "bun",
        "run",
        cliEntry,
        "init",
        projectName,
        "--template",
        "default",
        "--yes",
        "--no-install",
      ],
      smokeRunRoot,
    );

    console.log("2/5 install app third-party dependencies");
    await stripManduPackageDeps(projectDir);
    await runCommand(["bun", "install"], projectDir);

    console.log("3/5 dev smoke");
    const devPort = await getFreePort();
    const devCommand = startCommand(["bun", "run", cliEntry, "dev"], projectDir, {
      PORT: String(devPort),
    });

    try {
      await assertHealthEndpoint(`http://localhost:${devPort}/api/health`);
      await assertHomePage(`http://localhost:${devPort}/`);
    } catch (error) {
      const result = await stopCommand(devCommand);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n${formatCommandFailure(
          "Dev server logs",
          result,
        )}`,
      );
    }

    await stopCommand(devCommand);

    console.log("4/5 build smoke");
    await runCommand(["bun", "run", cliEntry, "build"], projectDir);
    await fs.access(path.join(projectDir, ".mandu", "manifest.json"));

    console.log("5/5 start smoke");
    const startPort = await getFreePort();
    const startCommandHandle = startCommand(["bun", "run", cliEntry, "start"], projectDir, {
      PORT: String(startPort),
    });

    try {
      await assertHealthEndpoint(`http://localhost:${startPort}/api/health`);
      await assertHomePage(`http://localhost:${startPort}/`);
    } catch (error) {
      const result = await stopCommand(startCommandHandle);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n${formatCommandFailure(
          "Production server logs",
          result,
        )}`,
      );
    }

    await stopCommand(startCommandHandle);

    console.log("Smoke passed: init -> dev -> build -> start");
  } catch (error) {
    cleanupTempDir = false;
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`Smoke workspace preserved at: ${projectDir}`);
    process.exitCode = 1;
  } finally {
    if (cleanupTempDir) {
      await fs.rm(smokeRunRoot, { recursive: true, force: true });
    }
  }
}

await main();
