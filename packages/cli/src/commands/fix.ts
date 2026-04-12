import { executeMcpTool } from "./mcp";

export interface FixOptions {
  apply?: boolean;
  file?: string;
  json?: boolean;
  preset?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fix(options: FixOptions = {}): Promise<boolean> {
  const result = await executeMcpTool("mandu_guard_heal", {
    autoFix: options.apply === true,
    file: options.file,
    preset: options.preset,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return isRecord(result) ? result.passed === true : true;
  }

  if (!isRecord(result)) {
    console.log(JSON.stringify(result, null, 2));
    return true;
  }

  const message = typeof result.message === "string" ? result.message : null;
  if (message) {
    console.log(message);
  }

  if (typeof result.totalViolations === "number") {
    console.log(`Violations: ${result.totalViolations}`);
  }

  if (typeof result.autoFixable === "number" && options.apply !== true) {
    console.log(`Auto-fixable: ${result.autoFixable}`);
  }

  const violations = Array.isArray(result.violations) ? result.violations : [];
  if (violations.length > 0) {
    console.log("");
    for (const violation of violations.slice(0, 5)) {
      if (!isRecord(violation)) continue;
      const file = typeof violation.file === "string" ? violation.file : "<unknown>";
      const line = typeof violation.line === "number" ? `:${violation.line}` : "";
      const text = typeof violation.message === "string" ? violation.message : "Violation detected";
      console.log(`- ${file}${line} ${text}`);
    }
    if (violations.length > 5) {
      console.log(`- ... ${violations.length - 5} more`);
    }
  }

  if (options.apply !== true && violations.length > 0) {
    console.log("\nTip: re-run with `mandu fix --apply` to apply available primary fixes.");
  }

  return result.passed === true;
}
