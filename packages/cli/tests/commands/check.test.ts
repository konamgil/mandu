import { describe, it, expect, mock } from "bun:test";
import { runLegacyGuardWithAutoHeal } from "../../src/commands/check";

describe("runLegacyGuardWithAutoHeal", () => {
  it("auto-heals when violations are auto-correctable", async () => {
    const runGuardCheck = mock()
      .mockResolvedValueOnce({
        passed: false,
        violations: [{ ruleId: "spec-hash-mismatch" }],
      })
      .mockResolvedValueOnce({
        passed: true,
        violations: [],
      });

    const result = await runLegacyGuardWithAutoHeal({ routes: [] } as unknown as Parameters<typeof runLegacyGuardWithAutoHeal>[0], "/tmp", {
      runGuardCheck,
      runAutoCorrect: mock().mockResolvedValue({ fixed: true }),
      isAutoCorrectableViolation: mock().mockReturnValue(true),
    });

    expect(result.passed).toBe(true);
    expect(result.autoHealed).toBe(true);
    expect(result.violations).toBe(0);
    expect(result.nextAction).toBeUndefined();
  });

  it("keeps nextAction when violations remain", async () => {
    const result = await runLegacyGuardWithAutoHeal({ routes: [] } as unknown as Parameters<typeof runLegacyGuardWithAutoHeal>[0], "/tmp", {
      runGuardCheck: mock().mockResolvedValue({
        passed: false,
        violations: [{ ruleId: "manual-fix" }],
      }),
      runAutoCorrect: mock(),
      isAutoCorrectableViolation: mock().mockReturnValue(false),
    });

    expect(result.passed).toBe(false);
    expect(result.autoHealed).toBe(false);
    expect(result.violations).toBe(1);
    expect(result.nextAction).toBe("mandu guard legacy");
  });
});
