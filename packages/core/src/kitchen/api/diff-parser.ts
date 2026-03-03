/**
 * Unified Diff Parser
 *
 * Parses git diff output into structured DiffHunk/DiffLine objects
 * for rendering in the Kitchen Preview panel.
 */

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isNew: boolean;
}

/**
 * Parse unified diff output for a single file.
 */
export function parseUnifiedDiff(raw: string, filePath: string): FileDiff {
  const result: FileDiff = {
    filePath,
    hunks: [],
    additions: 0,
    deletions: 0,
    isNew: false,
  };

  if (!raw.trim()) return result;

  const lines = raw.split("\n");
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Detect new file
    if (line.startsWith("new file mode")) {
      result.isNew = true;
      continue;
    }

    // Skip diff headers
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("Binary ")
    ) {
      continue;
    }

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(
      /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/,
    );
    if (hunkMatch) {
      currentHunk = {
        header: line,
        lines: [],
      };
      result.hunks.push(currentHunk);
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        newLine: newLine++,
      });
      result.additions++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "remove",
        content: line.slice(1),
        oldLine: oldLine++,
      });
      result.deletions++;
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
    // Skip "\ No newline at end of file" and other non-standard lines
  }

  return result;
}
