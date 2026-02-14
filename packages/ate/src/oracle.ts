import type { OracleLevel } from "./types";

export interface OracleResult {
  level: OracleLevel;
  l0: { ok: boolean; errors: string[] };
  l1: { ok: boolean; signals: string[] };
  l2: { ok: boolean; signals: string[] };
  l3: { ok: boolean; notes: string[] };
}

export function createDefaultOracle(level: OracleLevel): OracleResult {
  return {
    level,
    l0: { ok: true, errors: [] },
    l1: { ok: level === "L0" ? true : true, signals: [] },
    l2: { ok: true, signals: [] },
    l3: { ok: true, notes: [] },
  };
}
