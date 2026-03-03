/**
 * File API - Provides file read, diff, and recent changes for Kitchen Preview.
 *
 * GET /__kitchen/api/file?path=...        → file content
 * GET /__kitchen/api/file/diff?path=...   → git diff for file
 * GET /__kitchen/api/file/changes         → git status (recent changes)
 */

import path from "path";
import { parseUnifiedDiff, type FileDiff } from "./diff-parser";

export interface RecentFileChange {
  filePath: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export class FileAPI {
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
      const diff = await this.getGitDiff(filePath);
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

  private async getGitDiff(filePath: string): Promise<FileDiff> {
    const proc = Bun.spawn(["git", "diff", "--", filePath], {
      cwd: this.rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // If no staged/unstaged diff, try diff against HEAD for new files
    if (!stdout.trim()) {
      const procNew = Bun.spawn(
        ["git", "diff", "--no-index", "/dev/null", filePath],
        {
          cwd: this.rootDir,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const newStdout = await new Response(procNew.stdout).text();
      await procNew.exited;
      return parseUnifiedDiff(newStdout, filePath);
    }

    return parseUnifiedDiff(stdout, filePath);
  }

  private async getGitStatus(): Promise<RecentFileChange[]> {
    const proc = Bun.spawn(["git", "status", "--porcelain"], {
      cwd: this.rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const changes: RecentFileChange[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;

      const statusCode = line.substring(0, 2);
      const filePath = line.substring(3).trim();

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
