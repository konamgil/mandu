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
  SLOT_NOT_FOUND: {
    id: "SLOT_NOT_FOUND",
    name: "Slot File Not Found",
    description: "spec에 명시된 slotModule 파일을 찾을 수 없습니다",
  },
  // Contract-related rules
  CONTRACT_MISSING: {
    id: "CONTRACT_MISSING",
    name: "Contract Missing",
    description: "API 라우트에 contract가 정의되지 않았습니다",
  },
  CONTRACT_NOT_FOUND: {
    id: "CONTRACT_NOT_FOUND",
    name: "Contract File Not Found",
    description: "spec에 명시된 contractModule 파일을 찾을 수 없습니다",
  },
  CONTRACT_METHOD_NOT_IMPLEMENTED: {
    id: "CONTRACT_METHOD_NOT_IMPLEMENTED",
    name: "Contract Method Not Implemented",
    description: "Contract에 정의된 메서드가 Slot에 구현되지 않았습니다",
  },
  CONTRACT_METHOD_UNDOCUMENTED: {
    id: "CONTRACT_METHOD_UNDOCUMENTED",
    name: "Contract Method Undocumented",
    description: "Slot에 구현된 메서드가 Contract에 문서화되지 않았습니다",
  },
};

export const FORBIDDEN_IMPORTS = ["fs", "child_process", "cluster", "worker_threads"];
