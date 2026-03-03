/**
 * Guard Decision Manager
 *
 * Persists approve/reject decisions for guard violations.
 * Stored in .mandu/guard-decisions.json.
 */

import path from "path";
import fs from "fs";

export interface GuardDecision {
  id: string;
  violationKey: string; // "${ruleId}::${filePath}"
  action: "approve" | "reject";
  ruleId: string;
  filePath: string;
  reason?: string;
  decidedAt: string;
}

export class GuardDecisionManager {
  private filePath: string;
  private decisions: GuardDecision[] | null = null;

  constructor(private rootDir: string) {
    this.filePath = path.join(rootDir, ".mandu", "guard-decisions.json");
  }

  async load(): Promise<GuardDecision[]> {
    if (this.decisions !== null) return this.decisions;

    try {
      const file = Bun.file(this.filePath);
      if (await file.exists()) {
        const text = await file.text();
        this.decisions = JSON.parse(text);
        return this.decisions!;
      }
    } catch {
      // File doesn't exist or is corrupt
    }
    this.decisions = [];
    return this.decisions;
  }

  async save(
    decision: Omit<GuardDecision, "id" | "decidedAt">,
  ): Promise<GuardDecision> {
    const decisions = await this.load();

    const full: GuardDecision = {
      ...decision,
      id: generateId(),
      decidedAt: new Date().toISOString(),
    };

    // Replace existing decision for same violationKey
    const idx = decisions.findIndex(
      (d) => d.violationKey === full.violationKey,
    );
    if (idx >= 0) {
      decisions[idx] = full;
    } else {
      decisions.push(full);
    }

    this.decisions = decisions;
    await this.persist();
    return full;
  }

  async remove(id: string): Promise<boolean> {
    const decisions = await this.load();
    const idx = decisions.findIndex((d) => d.id === id);
    if (idx < 0) return false;

    decisions.splice(idx, 1);
    this.decisions = decisions;
    await this.persist();
    return true;
  }

  async isApproved(ruleId: string, filePath: string): Promise<boolean> {
    const decisions = await this.load();
    const key = `${ruleId}::${filePath}`;
    return decisions.some((d) => d.violationKey === key && d.action === "approve");
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await Bun.write(this.filePath, JSON.stringify(this.decisions, null, 2));
  }
}

function generateId(): string {
  return `gd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
