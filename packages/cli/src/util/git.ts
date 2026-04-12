export interface GitCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }
  return new Response(stream).text();
}

export async function runGit(args: string[], cwd = process.cwd()): Promise<GitCommandResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return {
    success: exitCode === 0,
    stdout,
    stderr,
    exitCode,
  };
}

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface ChangedFilesOptions {
  base?: string;
  staged?: boolean;
}

export async function getChangedFiles(
  options: ChangedFilesOptions = {},
  cwd = process.cwd(),
): Promise<{ files: string[]; notes: string[]; gitAvailable: boolean }> {
  const notes: string[] = [];
  const files = new Set<string>();

  const insideWorkTree = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!insideWorkTree.success || !insideWorkTree.stdout.includes("true")) {
    return {
      files: [],
      notes: ["Git repository not detected. Review falls back to project-wide diagnostics."],
      gitAvailable: false,
    };
  }

  if (options.base) {
    const diff = await runGit(["diff", "--name-only", `${options.base}...HEAD`], cwd);
    if (!diff.success) {
      notes.push(diff.stderr.trim() || `Failed to diff against base ${options.base}.`);
    } else {
      for (const file of toLines(diff.stdout)) {
        files.add(file);
      }
    }
  } else if (options.staged) {
    const staged = await runGit(["diff", "--name-only", "--cached"], cwd);
    if (!staged.success) {
      notes.push(staged.stderr.trim() || "Failed to read staged diff.");
    } else {
      for (const file of toLines(staged.stdout)) {
        files.add(file);
      }
    }
  } else {
    const [staged, unstaged, untracked] = await Promise.all([
      runGit(["diff", "--name-only", "--cached"], cwd),
      runGit(["diff", "--name-only"], cwd),
      runGit(["ls-files", "--others", "--exclude-standard"], cwd),
    ]);

    for (const result of [staged, unstaged, untracked]) {
      if (!result.success) {
        notes.push(result.stderr.trim() || "Failed to collect one of the git change sets.");
        continue;
      }
      for (const file of toLines(result.stdout)) {
        files.add(file);
      }
    }
  }

  return {
    files: Array.from(files).sort(),
    notes,
    gitAvailable: true,
  };
}
