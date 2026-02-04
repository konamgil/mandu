/**
 * Mandu 유틸리티 모듈
 *
 * ont-run 기법 도입에 따른 핵심 유틸리티
 * @see docs/plans/08_ont-run_adoption_plan.md
 */

// 해싱
export {
  computeConfigHash,
  verifyConfigIntegrity,
  compareConfigHashes,
  normalizeForHash,
  isHashable,
  getHashInfo,
  type HashOptions,
  type NormalizeOptions,
} from "./hasher.js";

// Diff
export {
  diffConfig,
  formatConfigDiff,
  printConfigDiff,
  summarizeDiff,
  hasConfigChanges,
  type ConfigDiff,
  type DiffFormatOptions,
} from "./differ.js";
