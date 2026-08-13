import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { tmpdir } from "node:os";

const repoRoot = path.resolve(import.meta.dir, "..");
const cliEntry = path.join(repoRoot, "packages", "cli", "src", "main.ts");
const referenceFetchTimeoutMs = 10_000;
// Keep staged consumers outside the monorepo so `bun install` creates their
// own lockfile instead of inheriting the repository workspace on Windows.
const scratchRoot = path.join(tmpdir(), "mandu-reference-apps");

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

interface ReferenceApp {
  id: string;
  source?: string;
  template?: "realtime-chat";
  prepare?(appDir: string): Promise<void>;
  assert(baseUrl: string): Promise<void>;
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream ? new Response(stream).text() : "";
}

function formatCommandFailure(prefix: string, result: CompletedCommand): string {
  return [
    prefix,
    `cwd: ${result.cwd}`,
    `command: ${result.args.join(" ")}`,
    `exitCode: ${result.exitCode}`,
    `stdout:\n${result.stdout.trim() || "<empty>"}`,
    `stderr:\n${result.stderr.trim() || "<empty>"}`,
  ].join("\n\n");
}

async function runCommand(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<CompletedCommand> {
  const proc = Bun.spawn(args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);
  const result = { args, cwd, stdout, stderr, exitCode };
  if (exitCode !== 0) throw new Error(formatCommandFailure("Command failed", result));
  return result;
}

function startCommand(args: string[], cwd: string, port: number): RunningCommand {
  const proc = Bun.spawn(args, {
    cwd,
    env: { ...process.env, PORT: String(port) },
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
    // The process may already have exited.
  }
  const exited = await Promise.race([
    command.proc.exited,
    Bun.sleep(5_000).then(() => -1),
  ]);
  if (exited === -1) {
    try {
      command.proc.kill("SIGKILL");
    } catch {
      // The process may have exited between the timeout and kill.
    }
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    command.stdoutPromise,
    command.stderrPromise,
    command.proc.exited,
  ]);
  return { ...command, stdout, stderr, exitCode };
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a reference-app port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForContract(
  command: RunningCommand,
  assertion: () => Promise<void>,
  timeoutMs = 60_000,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    if (command.proc.exitCode !== null) {
      throw new Error(`Server exited before its HTTP contract was ready (exit ${command.proc.exitCode})`);
    }
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(400);
    }
  }
  throw new Error(
    `HTTP contract timed out: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Bound every individual probe so one stalled socket cannot outlive the
 * retry deadline in waitForContract. Bun's default fetch timeout is several
 * minutes, which previously made a 60-second release gate hang for five.
 */
export function fetchReferenceApp(
  input: string | URL,
  init?: RequestInit,
  timeoutMs = referenceFetchTimeoutMs,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function assertText(url: string, expected: string): Promise<void> {
  const response = await fetchReferenceApp(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const body = await response.text();
  if (!body.includes(expected)) throw new Error(`${url} did not contain ${JSON.stringify(expected)}`);
}

async function assertJson(
  url: string,
  predicate: (value: unknown) => boolean,
  init?: RequestInit,
): Promise<void> {
  const response = await fetchReferenceApp(url, init);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const value: unknown = await response.json();
  if (!predicate(value)) throw new Error(`${url} returned an unexpected body: ${JSON.stringify(value)}`);
}

async function assertProtectedRedirect(url: string): Promise<void> {
  const response = await fetchReferenceApp(url, { redirect: "manual" });
  const location = response.headers.get("location");
  if (response.status !== 302 || !location?.endsWith("/login")) {
    throw new Error(`${url} expected 302 -> /login, got ${response.status} -> ${location ?? "<none>"}`);
  }
}

function mergeCookies(...setCookieGroups: string[][]): string {
  const cookies = new Map<string, string>();
  for (const setCookies of setCookieGroups) {
    for (const setCookie of setCookies) {
      const pair = setCookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function getSetCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function updateCookieHeader(cookieHeader: string, setCookies: string[]): string {
  const existing = cookieHeader ? cookieHeader.split(/;\s*/) : [];
  return mergeCookies(existing, setCookies);
}

async function assertSignupDashboard(baseUrl: string): Promise<string> {
  const signupPage = await fetchReferenceApp(`${baseUrl}/signup`);
  if (!signupPage.ok) throw new Error(`/signup returned ${signupPage.status}`);
  const html = await signupPage.text();
  const csrfToken = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (!csrfToken) throw new Error("/signup did not render a CSRF token");

  const email = `reference-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "reference-correct-horse";
  const initialCookies = getSetCookies(signupPage);
  const signup = await fetchReferenceApp(`${baseUrl}/api/signup`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: mergeCookies(initialCookies),
    },
    body: new URLSearchParams({
      _csrf: csrfToken,
      email,
      password,
      confirmPassword: password,
    }),
  });
  const location = signup.headers.get("location");
  if (![302, 303].includes(signup.status) || !location?.endsWith("/dashboard")) {
    throw new Error(`signup expected redirect to /dashboard, got ${signup.status} -> ${location ?? "<none>"}`);
  }

  const cookie = mergeCookies(initialCookies, getSetCookies(signup));
  const dashboard = await fetchReferenceApp(`${baseUrl}/dashboard`, { headers: { cookie } });
  if (!dashboard.ok) throw new Error(`authenticated /dashboard returned ${dashboard.status}`);
  const dashboardHtml = await dashboard.text();
  if (!dashboardHtml.includes(email)) throw new Error("authenticated dashboard did not render the signed-up user");
  return updateCookieHeader(cookie, getSetCookies(dashboard));
}

async function assertPersistentPost(baseUrl: string, cookie: string): Promise<void> {
  const postsPage = await fetchReferenceApp(`${baseUrl}/posts`, { headers: { cookie } });
  if (!postsPage.ok) throw new Error(`/posts returned ${postsPage.status}`);
  const html = await postsPage.text();
  const csrfToken = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (!csrfToken) throw new Error("/posts did not render a CSRF token");
  const currentCookie = updateCookieHeader(cookie, getSetCookies(postsPage));
  const title = `reference-post-${Date.now()}`;
  const create = await fetchReferenceApp(`${baseUrl}/api/posts`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: currentCookie,
    },
    body: new URLSearchParams({ _csrf: csrfToken, title, body: "reference body" }),
  });
  if (![302, 303].includes(create.status) || !create.headers.get("location")?.endsWith("/posts")) {
    throw new Error(`post creation expected redirect to /posts, got ${create.status}`);
  }
  const persisted = await fetchReferenceApp(`${baseUrl}/posts`, {
    headers: { cookie: updateCookieHeader(currentCookie, getSetCookies(create)) },
  });
  if (!persisted.ok || !(await persisted.text()).includes(title)) {
    throw new Error("created post did not survive the SQLite round trip");
  }
}

const references: ReferenceApp[] = [
  {
    id: "saas-dashboard",
    source: "demo/auth-starter",
    async prepare(appDir) {
      await runCommand(
        ["bun", "run", cliEntry, "db", "apply", "--ci"],
        appDir,
        { DATABASE_URL: "sqlite://./app.db" },
      );
    },
    async assert(baseUrl) {
      await assertText(`${baseUrl}/`, "Mandu Auth Starter");
      await assertProtectedRedirect(`${baseUrl}/dashboard`);
      const cookie = await assertSignupDashboard(baseUrl);
      await assertPersistentPost(baseUrl, cookie);
    },
  },
  {
    id: "contract-crud",
    source: "demo/todo-app",
    async assert(baseUrl) {
      await assertText(`${baseUrl}/`, "organized.");
      await assertJson(`${baseUrl}/api/todos`, (value) => {
        const body = value as { todos?: unknown; stats?: unknown };
        return Array.isArray(body.todos) && typeof body.stats === "object" && body.stats !== null;
      });
    },
  },
  {
    id: "interactive-realtime",
    template: "realtime-chat",
    async assert(baseUrl) {
      await assertText(`${baseUrl}/`, "Mandu Realtime Chat Starter");
      await assertJson(`${baseUrl}/api/health`, (value) => {
        const body = value as { status?: unknown; framework?: unknown };
        return body.status === "ok" && body.framework === "Mandu";
      });
      await assertJson(`${baseUrl}/api/chat/messages`, (value) => {
        const body = value as { messages?: unknown };
        return Array.isArray(body.messages);
      });
    },
  },
];

function shouldCopy(sourceRoot: string, candidate: string): boolean {
  const relative = path.relative(sourceRoot, candidate);
  if (!relative) return true;
  const [first] = relative.split(path.sep);
  if (["node_modules", ".mandu", "test-results", "playwright-report"].includes(first)) return false;
  if (first === ".env" || first.startsWith(".env.")) return false;
  return !["app.db", "app.db-journal", "app.db-wal", "app.db-shm"].includes(path.basename(candidate));
}

async function linkDirectory(source: string, target: string): Promise<void> {
  await fs.symlink(source, target, process.platform === "win32" ? "junction" : "dir");
}

async function stageWorkspaceApp(reference: ReferenceApp, appDir: string): Promise<void> {
  const sourceDir = path.join(repoRoot, reference.source!);
  await fs.cp(sourceDir, appDir, {
    recursive: true,
    filter: (candidate) => shouldCopy(sourceDir, candidate),
  });
  await installReferenceDependencies(appDir);
}

async function stripManduDependencies(appDir: string): Promise<void> {
  const packagePath = path.join(appDir, "package.json");
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const section of [pkg.dependencies, pkg.devDependencies]) {
    if (!section) continue;
    for (const name of Object.keys(section)) {
      if (name.startsWith("@mandujs/")) delete section[name];
    }
  }
  await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function installReferenceDependencies(appDir: string): Promise<void> {
  // Install the copied app as a real standalone consumer. Reusing a workspace
  // node_modules directory is not portable: Bun's generated Windows launchers
  // retain their original location and can cause `bun x` to download a second
  // CLI whose peer package is then invisible from the staged application.
  await stripManduDependencies(appDir);
  await runCommand(["bun", "install"], appDir);

  const coreTarget = path.join(appDir, "node_modules", "@mandujs", "core");
  await fs.mkdir(path.dirname(coreTarget), { recursive: true });
  await fs.rm(coreTarget, { recursive: true, force: true });
  await linkDirectory(path.join(repoRoot, "packages", "core"), coreTarget);
}

async function stageTemplateApp(reference: ReferenceApp, runRoot: string, appDir: string): Promise<void> {
  await runCommand([
    "bun", "run", cliEntry, "create", reference.id,
    "--template", reference.template!, "--yes", "--no-install",
  ], runRoot);
  await installReferenceDependencies(appDir);
}

async function verifyReference(reference: ReferenceApp, appDir: string): Promise<void> {
  console.log(`  lock   ${reference.id}`);
  await runCommand(["bun", "run", cliEntry, "lock"], appDir);
  if (reference.prepare) {
    console.log(`  setup  ${reference.id}`);
    await reference.prepare(appDir);
  }
  console.log(`  build  ${reference.id}`);
  await runCommand(["bun", "run", cliEntry, "build"], appDir);
  console.log(`  check  ${reference.id}`);
  await runCommand(["bun", "run", cliEntry, "check"], appDir);

  const port = await getFreePort();
  const server = startCommand(["bun", "run", cliEntry, "start"], appDir, port);
  try {
    await waitForContract(server, () => reference.assert(`http://127.0.0.1:${port}`));
  } catch (error) {
    const result = await stopCommand(server);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        formatCommandFailure(`${reference.id} server logs`, result),
      ].join("\n\n"),
      { cause: error },
    );
  }
  await stopCommand(server);
  console.log(`  pass   ${reference.id}`);
}

async function main(): Promise<void> {
  await fs.mkdir(scratchRoot, { recursive: true });
  const runRoot = await fs.mkdtemp(path.join(scratchRoot, "run-"));
  let cleanup = true;
  try {
    for (const reference of references) {
      const appDir = path.join(runRoot, reference.id);
      console.log(`stage ${reference.id}`);
      if (reference.source) await stageWorkspaceApp(reference, appDir);
      else await stageTemplateApp(reference, runRoot, appDir);
      await verifyReference(reference, appDir);
    }
    console.log(`Reference apps passed: ${references.map((reference) => reference.id).join(", ")}`);
  } catch (error) {
    cleanup = false;
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`Reference workspace preserved at: ${runRoot}`);
    process.exitCode = 1;
  } finally {
    if (cleanup) await fs.rm(runRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
