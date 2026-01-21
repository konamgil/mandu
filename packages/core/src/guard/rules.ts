export interface GuardViolation {
  ruleId: string;
  file: string;
  message: string;
  suggestion: string;
}

export interface GuardRule {
  id: string;
  name: string;
  description: string;
}

export const GUARD_RULES: Record<string, GuardRule> = {
  SPEC_HASH_MISMATCH: {
    id: "SPEC_HASH_MISMATCH",
    name: "Spec Hash Mismatch",
    description: "spec.lock.json의 해시와 현재 spec이 일치하지 않습니다",
  },
  GENERATED_MANUAL_EDIT: {
    id: "GENERATED_MANUAL_EDIT",
    name: "Generated File Manual Edit",
    description: "generated 파일이 수동으로 변경되었습니다",
  },
  INVALID_GENERATED_IMPORT: {
    id: "INVALID_GENERATED_IMPORT",
    name: "Invalid Generated Import",
    description: "non-generated 파일에서 generated 파일을 직접 import 했습니다",
  },
  FORBIDDEN_IMPORT_IN_GENERATED: {
    id: "FORBIDDEN_IMPORT_IN_GENERATED",
    name: "Forbidden Import in Generated",
    description: "generated 파일에서 금지된 모듈을 import 했습니다",
  },
};

export const FORBIDDEN_IMPORTS = ["fs", "child_process", "cluster", "worker_threads"];
