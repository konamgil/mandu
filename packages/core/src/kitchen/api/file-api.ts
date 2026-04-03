/**
 * File API - Provides file read, diff, and recent changes for Kitchen Preview.
 *
 * GET /__kitchen/api/file?path=...        → file content
 * GET /__kitchen/api/file/diff?path=...   → git diff for file
 * GET /__kitchen/api/file/changes         → git status (recent changes)
 */

import path from "path";
import fs from "fs";
import { parseUnifiedDiff, type FileDiff } from "./diff-parser";

export interface RecentFileChange {
  filePath: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export class FileAPI {
  private gitRoot: string | null | undefined;

  constructor(private rootDir: string) {}

  /**
   * GET /__kitchen/api/file?path=...
   * Read file content with language detection.
   */
  async handleReadFile(url: URL): Promise<Response> {
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return Response.json(
        { error: "Missing 'path' query parameter" },
        { status: 400 },
      );
    }

    const resolved = this.validatePath(filePath);
    if (!resolved) {
      return Response.json(
        { error: "Path outside project root" },
        { status: 403 },
      );
    }

    try {
      const file = Bun.file(resolved);
      const exists = await file.exists();
      if (!exists) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      const content = await file.text();
      const language = detectLanguage(filePath);

      return Response.json({ filePath, content, language });
    } catch (error) {
      return Response.json(
        { error: "Failed to read file" },
        { status: 500 },
      );
    }
  }

  /**
   * GET /__kitchen/api/file/diff?path=...
   * Get git diff for a specific file.
   */
  async handleFileDiff(url: URL): Promise<Response> {
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return Response.json(
        { error: "Missing 'path' query parameter" },
        { status: 400 },
      );
    }

    const resolved = this.validatePath(filePath);
    if (!resolved) {
      return Response.json(
        { error: "Path outside project root" },
        { status: 403 },
      );
    }

    try {
      const diff = await this.getFileDiff(filePath, resolved);
      return Response.json(diff);
    } catch (error) {
      return Response.json(
        { error: "Failed to get diff" },
        { status: 500 },
      );
    }
  }

  /**
   * GET /__kitchen/api/file/changes
   * List recently changed files via git status.
   */
  async handleRecentChanges(): Promise<Response> {
    try {
      const changes = await this.getGitStatus();
      return Response.json({ changes });
    } catch (error) {
      return Response.json(
        { error: "Failed to get changes" },
        { status: 500 },
      );
    }
  }

  // ────────────────────────────────────────────────

  private validatePath(filePath: string): string | null {
    const resolved = path.resolve(this.rootDir, filePath);
    if (!resolved.startsWith(this.rootDir + path.sep) && resolved !== this.rootDir) {
      return null;
    }
    return resolved;
  }

  private getGitRoot(): string | null {
    if (this.gitRoot !== undefined) {
      return this.gitRoot;
    }

    let current = path.resolve(this.rootDir);
    while (true) {
      if (fs.existsSync(path.join(current, ".git"))) {
        this.gitRoot = current;
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        this.gitRoot = null;
        return null;
      }
      current = parent;
    }
  }

  private async runGit(args: string[], cwd: string): Promise<string> {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(stderr || stdout || `git ${args.join(" ")} failed`);
    }

    return stdout;
  }

  private getRepoRelativePath(resolvedPath: string, gitRoot: string): string {
    return path.relative(gitRoot, resolvedPath).replace(/\\/g, "/");
  }

  private getProjectRelativePath(repoRelativePath: string, gitRoot: string): string {
    const absolutePath = path.resolve(gitRoot, repoRelativePath.replace(/\//g, path.sep));
    return path.relative(this.rootDir, absolutePath).replace(/\\/g, "/");
  }

  private async getFileDiff(filePath: string, resolvedPath: string): Promise<FileDiff> {
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      return this.createSyntheticDiff(filePath, resolvedPath);
    }

    const repoRelativePath = this.getRepoRelativePath(resolvedPath, gitRoot);
    const stdout = await this.runGit(["diff", "--", repoRelativePath], gitRoot);
    if (stdout.trim()) {
      return parseUnifiedDiff(stdout, filePath);
    }

    if (!fs.existsSync(resolvedPath)) {
      return parseUnifiedDiff("", filePath);
    }

    const status = await this.runGit(["status", "--porcelain", "--", repoRelativePath], gitRoot);
    if (status.trim().startsWith("??")) {
      return this.createSyntheticDiff(filePath, resolvedPath);
    }

    return parseUnifiedDiff("", filePath);
  }

  private createSyntheticDiff(filePath: string, resolvedPath: string): FileDiff {
    // Bun.file().text() is async, but synthetic diffs are only used in non-git fallback.
    // Use fs for synchronous fallback to keep the response fast.
    const normalized = fs.readFileSync(resolvedPath, "utf-8").replace(/\r\n/g, "\n");
    if (!normalized) {
      return parseUnifiedDiff("", filePath);
    }

    const lines = normalized.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    const raw = [
      "new file mode 100644",
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n");

    return parseUnifiedDiff(raw, filePath);
  }

  private async getGitStatus(): Promise<RecentFileChange[]> {
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      return [];
    }

    const repoRelativeRoot = this.getRepoRelativePath(this.rootDir, gitRoot);
    const args = ["status", "--porcelain"];
    if (repoRelativeRoot && repoRelativeRoot !== ".") {
      args.push("--", repoRelativeRoot);
    }

    const stdout = await this.runGit(args, gitRoot);

    const changes: RecentFileChange[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;

      const statusCode = line.substring(0, 2);
      const gitFilePath = line.substring(3).trim();
      const filePath = this.getProjectRelativePath(gitFilePath, gitRoot);

      changes.push({
        filePath,
        status: parseGitStatus(statusCode),
      });
    }

    return changes;
  }
}

function parseGitStatus(code: string): RecentFileChange["status"] {
  const x = code[0];
  const y = code[1];

  if (x === "?" || y === "?") return "untracked";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  return "modified";
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".css": "css",
    ".html": "html",
    ".md": "markdown",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
  };
  return langMap[ext] || "text";
}
