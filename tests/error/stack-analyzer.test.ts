/**
 * StackTraceAnalyzer Tests
 */

import { describe, test, expect } from "bun:test";
import { StackTraceAnalyzer, type StackFrame } from "../../packages/core/src/error/stack-analyzer";

describe("StackTraceAnalyzer", () => {
  describe("parseStack", () => {
    test("should parse V8/Bun stack trace format", () => {
      const stack = `Error: Test error
    at functionName (path/to/file.ts:10:15)
    at anotherFunction (path/to/another.ts:20:5)`;

      const analyzer = new StackTraceAnalyzer();
      const frames = analyzer.parseStack(stack);

      expect(frames.length).toBe(2);
      expect(frames[0].file).toBe("path/to/file.ts");
      expect(frames[0].line).toBe(10);
      expect(frames[0].column).toBe(15);
      expect(frames[0].functionName).toBe("functionName");
      expect(frames[0].isNative).toBe(false);
    });

    test("should handle anonymous functions", () => {
      const stack = `Error: Test
    at <anonymous> (file.ts:5:3)`;

      const analyzer = new StackTraceAnalyzer();
      const frames = analyzer.parseStack(stack);

      expect(frames.length).toBe(1);
      expect(frames[0].functionName).toBe("<anonymous>");
    });

    test("should return empty array for undefined stack", () => {
      const analyzer = new StackTraceAnalyzer();
      const frames = analyzer.parseStack(undefined);

      expect(frames).toEqual([]);
    });

    test("should handle Windows-style paths", () => {
      const stack = `Error: Test
    at func (C:\\Users\\User\\project\\src\\file.ts:10:5)`;

      const analyzer = new StackTraceAnalyzer();
      const frames = analyzer.parseStack(stack);

      expect(frames.length).toBe(1);
      expect(frames[0].file).toContain("file.ts");
    });
  });

  describe("isSlotFile", () => {
    test("should identify slot files", () => {
      const analyzer = new StackTraceAnalyzer();

      expect(analyzer.isSlotFile("spec/slots/users.slot.ts")).toBe(true);
      expect(analyzer.isSlotFile("spec/slots/nested/deep.slot.ts")).toBe(true);
      expect(analyzer.isSlotFile("/absolute/spec/slots/file.slot.ts")).toBe(true);
    });

    test("should not identify non-slot files as slots", () => {
      const analyzer = new StackTraceAnalyzer();

      expect(analyzer.isSlotFile("packages/core/src/filling.ts")).toBe(false);
      expect(analyzer.isSlotFile("src/utils/helper.ts")).toBe(false);
    });
  });

  describe("isSpecFile", () => {
    test("should identify spec-related files", () => {
      const analyzer = new StackTraceAnalyzer();

      expect(analyzer.isSpecFile("spec/load.ts")).toBe(true);
      expect(analyzer.isSpecFile("packages/core/src/spec/schema.ts")).toBe(true);
      expect(analyzer.isSpecFile(".mandu/routes.manifest.json")).toBe(true);
    });

    test("should not identify slot files as spec files", () => {
      const analyzer = new StackTraceAnalyzer();

      // slot files are in spec/ but should not be classified as spec files
      expect(analyzer.isSpecFile("spec/slots/users.slot.ts")).toBe(false);
    });

    test("should not identify non-spec files", () => {
      const analyzer = new StackTraceAnalyzer();

      expect(analyzer.isSpecFile("packages/core/src/runtime/server.ts")).toBe(false);
      expect(analyzer.isSpecFile("src/components/App.tsx")).toBe(false);
    });
  });

  describe("isFrameworkFile", () => {
    test("should identify framework files", () => {
      const analyzer = new StackTraceAnalyzer();

      expect(analyzer.isFrameworkFile("packages/core/src/runtime/server.ts")).toBe(true);
      expect(analyzer.isFrameworkFile("packages/core/src/filling/filling.ts")).toBe(true);
      expect(analyzer.isFrameworkFile("@mandujs/core/src/index.ts")).toBe(true);
    });

    test("should not identify user files as framework files", () => {
      const analyzer = new StackTraceAnalyzer();

      expect(analyzer.isFrameworkFile("src/components/App.tsx")).toBe(false);
      expect(analyzer.isFrameworkFile("spec/slots/users.slot.ts")).toBe(false);
      expect(analyzer.isFrameworkFile("app/api/users/route.ts")).toBe(false);
    });

    test("should not identify external node_modules as framework files", () => {
      const analyzer = new StackTraceAnalyzer();

      // External libraries in node_modules should not be framework files
      expect(analyzer.isFrameworkFile("node_modules/express/index.js")).toBe(false);
      expect(analyzer.isFrameworkFile("node_modules/zod/lib/index.js")).toBe(false);
    });
  });

  describe("findBlameFrame", () => {
    test("should find first slot frame as blame", () => {
      const analyzer = new StackTraceAnalyzer();

      const stack = `Error: Slot error
    at handler (spec/slots/users.slot.ts:15:10)
    at processRequest (packages/core/src/filling/filling.ts:50:5)`;

      const frames = analyzer.parseStack(stack);
      const blame = analyzer.findBlameFrame(frames);

      expect(blame?.file).toBe("spec/slots/users.slot.ts");
      expect(blame?.line).toBe(15);
    });

    test("should find spec frame as blame when no slot frame", () => {
      const analyzer = new StackTraceAnalyzer();

      const stack = `Error: Spec error
    at loadSpec (packages/core/src/spec/load.ts:20:10)
    at init (packages/core/src/index.ts:5:3)`;

      const frames = analyzer.parseStack(stack);
      const blame = analyzer.findBlameFrame(frames);

      expect(blame?.file).toContain("spec/load.ts");
    });

    test("should return null for empty frames", () => {
      const analyzer = new StackTraceAnalyzer();
      const blame = analyzer.findBlameFrame([]);

      expect(blame).toBeNull();
    });

    test("should return first non-native frame when no slot or spec frame", () => {
      const analyzer = new StackTraceAnalyzer();

      const stack = `Error: Unknown error
    at someFunction (external/lib/file.ts:10:5)
    at anotherFunction (external/lib/other.ts:20:5)`;

      const frames = analyzer.parseStack(stack);
      const blame = analyzer.findBlameFrame(frames);

      expect(blame?.file).toBe("external/lib/file.ts");
    });
  });

  describe("determineErrorSource", () => {
    test("should return 'slot' for slot files", () => {
      const analyzer = new StackTraceAnalyzer();

      const stack = `Error: Test
    at handler (spec/slots/users.slot.ts:10:5)`;

      const frames = analyzer.parseStack(stack);
      const source = analyzer.determineErrorSource(frames);

      expect(source).toBe("slot");
    });

    test("should return 'spec' for spec files", () => {
      const analyzer = new StackTraceAnalyzer();

      const stack = `Error: Test
    at loadSpec (packages/core/src/spec/load.ts:10:5)`;

      const frames = analyzer.parseStack(stack);
      const source = analyzer.determineErrorSource(frames);

      expect(source).toBe("spec");
    });

    test("should return 'framework' for framework files", () => {
      const analyzer = new StackTraceAnalyzer();

      const stack = `Error: Test
    at internal (packages/core/src/runtime/server.ts:10:5)`;

      const frames = analyzer.parseStack(stack);
      const source = analyzer.determineErrorSource(frames);

      expect(source).toBe("framework");
    });

    test("should return 'unknown' for unidentified sources", () => {
      const analyzer = new StackTraceAnalyzer();

      const stack = `Error: Test
    at something (external/library/file.ts:10:5)`;

      const frames = analyzer.parseStack(stack);
      const source = analyzer.determineErrorSource(frames);

      expect(source).toBe("unknown");
    });
  });
});
