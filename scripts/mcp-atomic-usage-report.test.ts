import { describe, expect, it } from "bun:test";
import { writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { buildReport } from "./mcp-atomic-usage-report";

interface FixtureEvent {
  ts: string;
  type: string;
  data?: Record<string, unknown>;
}

async function withFixture(
  events: FixtureEvent[],
  run: (logPath: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "mandu-usage-report-"));
  const logPath = path.join(root, "activity.jsonl");
  try {
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(logPath, lines);
    await run(logPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("buildReport", () => {
  it("counts tool.call events grouped by tool name", async () => {
    await withFixture(
      [
        { ts: "2026-05-20T10:00:00Z", type: "tool.call", data: { tool: "mandu.agent.context" } },
        { ts: "2026-05-20T10:01:00Z", type: "tool.call", data: { tool: "mandu.agent.context" } },
        { ts: "2026-05-20T10:02:00Z", type: "tool.call", data: { tool: "mandu.agent.verify" } },
        { ts: "2026-05-20T10:03:00Z", type: "system.event" }, // not a tool.call → ignored
      ],
      async (logPath) => {
        const report = buildReport({ logPath, json: false, top: 10 });
        expect(report.totals.totalCalls).toBe(3);
        expect(report.totals.distinctTools).toBe(2);
        expect(report.topCalled[0]).toMatchObject({
          tool: "mandu.agent.context",
          calls: 2,
        });
        expect(report.topCalled[1]).toMatchObject({
          tool: "mandu.agent.verify",
          calls: 1,
        });
      },
    );
  });

  it("respects --days cutoff", async () => {
    const now = Date.now();
    const dayAgo = new Date(now - 86_400_000).toISOString();
    const tenDaysAgo = new Date(now - 10 * 86_400_000).toISOString();
    await withFixture(
      [
        { ts: dayAgo, type: "tool.call", data: { tool: "mandu.agent.context" } },
        { ts: tenDaysAgo, type: "tool.call", data: { tool: "mandu.agent.verify" } },
      ],
      async (logPath) => {
        const report = buildReport({ logPath, json: false, top: 10, days: 7 });
        expect(report.totals.totalCalls).toBe(1);
        expect(report.topCalled).toHaveLength(1);
        expect(report.topCalled[0]!.tool).toBe("mandu.agent.context");
      },
    );
  });

  it("flags registered tools that were never called as deprecation candidates", async () => {
    await withFixture(
      [
        { ts: "2026-05-20T10:00:00Z", type: "tool.call", data: { tool: "mandu.agent.context" } },
      ],
      async (logPath) => {
        const report = buildReport({ logPath, json: false, top: 10 });
        // mandu.agent.context was called → must NOT be in zero-call
        expect(report.zeroCall.find((z) => z.tool === "mandu.agent.context")).toBeUndefined();
        // At least one expert-tier atomic should remain uncalled in this fixture
        expect(report.zeroCall.length).toBeGreaterThan(0);
        expect(report.zeroCall.some((z) => z.profile === "expert")).toBe(true);
      },
    );
  });

  it("classifies tools into agent-core / agent-full / expert profiles", async () => {
    await withFixture(
      [
        { ts: "2026-05-20T10:00:00Z", type: "tool.call", data: { tool: "mandu.agent.context" } },
      ],
      async (logPath) => {
        const report = buildReport({ logPath, json: false, top: 10 });
        const profiles = new Set(report.byProfile.map((p) => p.profile));
        expect(profiles.has("agent-core")).toBe(true);
        expect(profiles.has("agent-full")).toBe(true);
        expect(profiles.has("expert")).toBe(true);
        // No tool should be classified as "unknown" in a healthy registry
        const unknown = report.byProfile.find((p) => p.profile === "unknown");
        expect(unknown).toBeUndefined();
      },
    );
  });

  it("handles malformed lines without crashing", async () => {
    await withFixture(
      [
        { ts: "2026-05-20T10:00:00Z", type: "tool.call", data: { tool: "mandu.agent.context" } },
      ],
      async (logPath) => {
        // Append a malformed line
        writeFileSync(logPath, "{not valid json}\n", { flag: "a" });
        const report = buildReport({ logPath, json: false, top: 10 });
        expect(report.totals.totalCalls).toBe(1);
      },
    );
  });
});
