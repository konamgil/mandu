/**
 * Wave R2 integration smoke harness.
 * - Directly instantiates MCP tool handlers from source to verify shape.
 * - Runs loop-closure detectors against synthetic inputs.
 * - Outputs JSON for the QA report.
 *
 * Invoked via: bun run scripts/qa/wave-r2-smoke.ts
 */

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEMO_DIR = path.join(REPO_ROOT, "demo", "auth-starter");

type R = { name: string; ok: boolean; note?: string; shape?: unknown };
const results: R[] = [];

function record(name: string, ok: boolean, note?: string, shape?: unknown) {
  results.push({ name, ok, note, shape });
}

// Scenario 5a: mandu.run.tests — invoke directly from repo root
// so resolveManduCommand picks up packages/cli/src/main.ts
try {
  const { runTestsTools } = await import("../../packages/mcp/src/tools/run-tests.ts");
  const handlers = runTestsTools(REPO_ROOT);
  const fn = handlers["mandu.run.tests"];
  if (!fn) throw new Error("tool handler not registered");
  // Use filter to constrain this to a very small fast test to avoid waiting.
  const res = await fn({ target: "unit", filter: "nonexistent-filter-xyz" });
  const shape = res as Record<string, unknown>;
  const hasKeys =
    typeof shape === "object" &&
    shape !== null &&
    (("passed" in shape && "failed" in shape && "skipped" in shape) || "error" in shape);
  record("mandu.run.tests (shape)", hasKeys, undefined, {
    target: shape.target,
    passed: shape.passed,
    failed: shape.failed,
    skipped: shape.skipped,
    exit_code: shape.exit_code,
    note: shape.note,
    has_stdout_tail: typeof shape.stdout_tail === "string",
  });
} catch (e: unknown) {
  record("mandu.run.tests (shape)", false, (e as Error)?.message ?? String(e));
}

// Scenario 5b: mandu.deploy.preview — invoke from REPO_ROOT so resolveManduCommand finds the CLI
try {
  const { deployPreviewTools } = await import("../../packages/mcp/src/tools/deploy-preview.ts");
  const handlers = deployPreviewTools(REPO_ROOT);
  const fn = handlers["mandu.deploy.preview"];
  if (!fn) throw new Error("tool handler not registered");
  const res = await fn({ target: "vercel" });
  const shape = res as Record<string, unknown>;
  const hasArtifactList =
    typeof shape === "object" &&
    shape !== null &&
    "artifact_list" in shape &&
    Array.isArray((shape as { artifact_list: unknown }).artifact_list);
  record("mandu.deploy.preview[vercel]", hasArtifactList, undefined, {
    target: shape.target,
    mode: shape.mode,
    artifact_list_len: Array.isArray(shape.artifact_list) ? shape.artifact_list.length : -1,
    warnings_len: Array.isArray(shape.warnings) ? shape.warnings.length : -1,
    exit_code: shape.exit_code,
    first_artifact: Array.isArray(shape.artifact_list) && shape.artifact_list.length > 0 ? shape.artifact_list[0] : null,
  });
} catch (e: unknown) {
  record("mandu.deploy.preview[vercel]", false, (e as Error)?.message ?? String(e));
}

// Scenario 5c: mandu.ai.brief
try {
  const { aiBriefTools } = await import("../../packages/mcp/src/tools/ai-brief.ts");
  const handlers = aiBriefTools(REPO_ROOT);
  const fn = handlers["mandu.ai.brief"];
  if (!fn) throw new Error("tool handler not registered");
  const res = await fn({ depth: "short" });
  const shape = res as Record<string, unknown>;
  const hasTitleSummaryFiles =
    typeof shape.title === "string" &&
    typeof shape.summary === "string" &&
    Array.isArray(shape.files);
  record("mandu.ai.brief", hasTitleSummaryFiles, undefined, {
    title: shape.title,
    depth: shape.depth,
    files_len: Array.isArray(shape.files) ? shape.files.length : -1,
    skills_len: Array.isArray(shape.skills) ? shape.skills.length : -1,
    docs_len: Array.isArray(shape.docs) ? shape.docs.length : -1,
  });
} catch (e: unknown) {
  record("mandu.ai.brief", false, (e as Error)?.message ?? String(e));
}

// Scenario 5d: mandu.loop.close — synthetic failing input
try {
  const { loopCloseTools } = await import("../../packages/mcp/src/tools/loop-close.ts");
  const handlers = loopCloseTools(REPO_ROOT);
  const fn = handlers["mandu.loop.close"];
  if (!fn) throw new Error("tool handler not registered");
  const stdout = `
bun test v1.3.12
(fail) my test > should pass
error: expected 1 to be 2
 1 pass
 1 fail
`;
  const res = await fn({ stdout, stderr: "", exitCode: 1 });
  const shape = res as Record<string, unknown>;
  const hasEvidence =
    Array.isArray(shape.evidence) &&
    typeof shape.stallReason === "string" &&
    typeof shape.nextPrompt === "string";
  record("mandu.loop.close", hasEvidence, undefined, {
    stallReason: shape.stallReason,
    evidence_len: Array.isArray(shape.evidence) ? shape.evidence.length : -1,
  });
} catch (e: unknown) {
  record("mandu.loop.close", false, (e as Error)?.message ?? String(e));
}

// Scenario 6: Loop closure detectors — one synthetic input per detector ID
try {
  const { closeLoop, listDetectorIds } = await import(
    "../../packages/skills/src/loop-closure/index.ts"
  );
  const ids = listDetectorIds();

  // Synthetic inputs targeting each detector (expect matching id to fire).
  const cases: Array<{ detector: string; stdout: string; stderr?: string; exit: number }> = [
    {
      detector: "typecheck-error",
      stdout: "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      exit: 1,
    },
    {
      detector: "test-failure",
      stdout: "(fail) my suite > should work\nerror: expected 1 === 2\n 0 pass\n 1 fail\n",
      exit: 1,
    },
    {
      detector: "missing-module",
      stdout: "error: Cannot find module 'x' from 'y.ts'",
      exit: 1,
    },
    {
      detector: "syntax-error",
      stdout: "SyntaxError: Unexpected token '{'",
      exit: 1,
    },
    {
      detector: "not-implemented",
      stdout: 'Error: throw new Error("not implemented")',
      exit: 1,
    },
    {
      detector: "unhandled-rejection",
      stdout: "UnhandledPromiseRejectionWarning: boom",
      exit: 1,
    },
    {
      detector: "incomplete-function",
      // Function body literally empty — this is the typical signature.
      stdout: 'export function foo() {}',
      exit: 0,
    },
    {
      detector: "todo-marker",
      stdout: "// TODO: add the caching layer",
      exit: 0,
    },
    {
      detector: "fixme-marker",
      stdout: "// FIXME: flaky under heavy load",
      exit: 0,
    },
    {
      detector: "stack-trace",
      // stack trace detection is gated on non-zero exit
      stdout: "Error: boom\n    at foo (src/bar.ts:12:5)\n    at baz (src/qux.ts:34:7)\n    at qux (src/foo.ts:1:1)\n",
      exit: 1,
    },
  ];

  for (const c of cases) {
    try {
      const out = closeLoop({ stdout: c.stdout, stderr: "", exitCode: c.exit });
      const fired =
        Array.isArray(out.evidence) && out.evidence.some((ev: { kind: string }) => ev.kind === c.detector);
      record(`detector:${c.detector}`, fired, fired ? undefined : `expected detector ${c.detector} to fire`, {
        stallReason: out.stallReason,
        firedKinds: Array.isArray(out.evidence)
          ? out.evidence.map((ev: { kind: string }) => ev.kind)
          : [],
      });
    } catch (e: unknown) {
      record(`detector:${c.detector}`, false, (e as Error)?.message ?? String(e));
    }
  }

  record("detectors:count", ids.length === 10, `expected 10 detectors, got ${ids.length}`, { ids });
} catch (e: unknown) {
  record("detectors:load", false, (e as Error)?.message ?? String(e));
}

// Scenario 10d: verify @mandujs/core/testing exports
try {
  const mod = await import("../../packages/core/src/testing/index.ts");
  const exported = Object.keys(mod).sort();
  // Snapshot helpers may be in separate submodule — check testing dir for snapshot
  record("testing/index exports", exported.length > 0, undefined, { exported });
} catch (e: unknown) {
  record("testing/index exports", false, (e as Error)?.message ?? String(e));
}

// Scenario 10d.b: check if snapshot helper is present anywhere in testing submodule
try {
  const testingBarrel = await import("../../packages/core/src/testing/index.ts");
  const barrelKeys = Object.keys(testingBarrel);
  const hasSnapInBarrel = barrelKeys.some((k) => /snap/i.test(k));
  let hasSnapInSubpath = false;
  let subpathExports: string[] = [];
  try {
    const maybeSnap = await import("../../packages/core/src/testing/snapshot.ts");
    subpathExports = Object.keys(maybeSnap);
    hasSnapInSubpath = subpathExports.length > 0;
  } catch {
    hasSnapInSubpath = false;
  }
  record(
    "core/testing snapshot helper exists",
    hasSnapInBarrel || hasSnapInSubpath,
    hasSnapInBarrel || hasSnapInSubpath
      ? undefined
      : "no snap helper in packages/core/src/testing/index.ts OR snapshot.ts",
    {
      barrelKeys,
      hasSnapInBarrel,
      hasSnapInSubpath,
      subpathExports,
    },
  );
} catch (e: unknown) {
  record("core/testing snapshot helper exists", false, (e as Error)?.message ?? String(e));
}

console.log(JSON.stringify({ total: results.length, results }, null, 2));
