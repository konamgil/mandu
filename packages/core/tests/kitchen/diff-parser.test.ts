import { describe, it, expect } from "bun:test";
import { parseUnifiedDiff } from "../../src/kitchen/api/diff-parser";

describe("parseUnifiedDiff", () => {
  it("should parse empty diff", () => {
    const result = parseUnifiedDiff("", "test.ts");
    expect(result.filePath).toBe("test.ts");
    expect(result.hunks).toHaveLength(0);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.isNew).toBe(false);
  });

  it("should parse a simple diff with additions and deletions", () => {
    const raw = `diff --git a/test.ts b/test.ts
index abc..def 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;`;

    const result = parseUnifiedDiff(raw, "test.ts");
    expect(result.filePath).toBe("test.ts");
    expect(result.hunks).toHaveLength(1);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
    expect(result.isNew).toBe(false);

    const hunk = result.hunks[0];
    expect(hunk.lines).toHaveLength(5);

    // Context line
    expect(hunk.lines[0].type).toBe("context");
    expect(hunk.lines[0].content).toBe("const a = 1;");
    expect(hunk.lines[0].oldLine).toBe(1);
    expect(hunk.lines[0].newLine).toBe(1);

    // Removed line
    expect(hunk.lines[1].type).toBe("remove");
    expect(hunk.lines[1].content).toBe("const b = 2;");
    expect(hunk.lines[1].oldLine).toBe(2);

    // Added lines
    expect(hunk.lines[2].type).toBe("add");
    expect(hunk.lines[2].content).toBe("const b = 3;");
    expect(hunk.lines[2].newLine).toBe(2);

    expect(hunk.lines[3].type).toBe("add");
    expect(hunk.lines[3].content).toBe("const c = 4;");
    expect(hunk.lines[3].newLine).toBe(3);
  });

  it("should detect new files", () => {
    const raw = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+const x = 1;
+export default x;`;

    const result = parseUnifiedDiff(raw, "new.ts");
    expect(result.isNew).toBe(true);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
  });

  it("should parse multiple hunks", () => {
    const raw = `diff --git a/multi.ts b/multi.ts
--- a/multi.ts
+++ b/multi.ts
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
@@ -10,3 +10,3 @@
 line 10
-line 11
+line 11 modified
 line 12`;

    const result = parseUnifiedDiff(raw, "multi.ts");
    expect(result.hunks).toHaveLength(2);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(2);

    expect(result.hunks[0].lines).toHaveLength(4);
    expect(result.hunks[1].lines).toHaveLength(4);
  });
});
