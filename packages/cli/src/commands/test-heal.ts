import { theme } from "../terminal";
import { ateHeal } from "@mandujs/ate";

export async function testHeal(): Promise<boolean> {
  const repoRoot = process.cwd();
  try {
    const runId = "latest"; // minimal skeleton
    const res = ateHeal({ repoRoot, runId });
    console.log(JSON.stringify(res, null, 2));
    return true;
  } catch (err) {
    console.error(theme.error("ATE test:heal failed"), err);
    return false;
  }
}
