export interface GuardViolation {
  ruleId: string;
  file: string;
  message: string;
  suggestion: string;
  line?: number;
  severity?: "error" | "warning";
}

export interface GuardRule {
  id: string;
  name: string;
  description: string;
  severity: "error" | "warning";
}

export const GUARD_RULES: Record<string, GuardRule> = {
  GENERATED_MANUAL_EDIT: {
    id: "GENERATED_MANUAL_EDIT",
    name: "Generated File Manual Edit",
    description: "generated 파일이 수동으로 변경되었습니다",
    severity: "error",
  },
  INVALID_GENERATED_IMPORT: {
    id: "INVALID_GENERATED_IMPORT",
    name: "Invalid Generated Import",
    description: "non-generated 파일에서 generated 파일을 직접 import 했습니다",
    severity: "error",
  },
  FORBIDDEN_IMPORT_IN_GENERATED: {
    id: "FORBIDDEN_IMPORT_IN_GENERATED",
    name: "Forbidden Import in Generated",
    description: "generated 파일에서 금지된 모듈을 import 했습니다",
    severity: "error",
  },
  SLOT_NOT_FOUND: {
    id: "SLOT_NOT_FOUND",
    name: "Slot File Not Found",
    description: "spec에 명시된 slotModule 파일을 찾을 수 없습니다",
    severity: "error",
  },
  // Slot validation rules (신규)
  SLOT_MISSING_DEFAULT_EXPORT: {
    id: "SLOT_MISSING_DEFAULT_EXPORT",
    name: "Slot Missing Default Export",
    description: "Slot 파일에 export default가 없습니다",
    severity: "error",
  },
  SLOT_INVALID_RETURN: {
    id: "SLOT_INVALID_RETURN",
    name: "Slot Invalid Handler Return",
    description: "Slot 핸들러가 올바른 Response를 반환하지 않습니다",
    severity: "error",
  },
  SLOT_NO_RESPONSE_PATTERN: {
    id: "SLOT_NO_RESPONSE_PATTERN",
    name: "Slot No Response Pattern",
    description: "Slot 핸들러에 ctx.ok(), ctx.json() 등의 응답 패턴이 없습니다",
    severity: "error",
  },
  SLOT_MISSING_FILLING_PATTERN: {
    id: "SLOT_MISSING_FILLING_PATTERN",
    name: "Slot Missing Filling Pattern",
    description: "Slot 파일에 Mandu.filling() 패턴이 없습니다",
    severity: "error",
  },
  SLOT_ZOD_DIRECT_IMPORT: {
    id: "SLOT_ZOD_DIRECT_IMPORT",
    name: "Zod Direct Import in Slot",
    description: "Slot 파일에서 zod를 직접 import 했습니다",
    severity: "error",
  },
  // Contract-related rules
  CONTRACT_MISSING: {
    id: "CONTRACT_MISSING",
    name: "Contract Missing",
    description: "API 라우트에 contract가 정의되지 않았습니다",
    severity: "warning",
  },
  CONTRACT_NOT_FOUND: {
    id: "CONTRACT_NOT_FOUND",
    name: "Contract File Not Found",
    description: "spec에 명시된 contractModule 파일을 찾을 수 없습니다",
    severity: "error",
  },
  CONTRACT_METHOD_NOT_IMPLEMENTED: {
    id: "CONTRACT_METHOD_NOT_IMPLEMENTED",
    name: "Contract Method Not Implemented",
    description: "Contract에 정의된 메서드가 Slot에 구현되지 않았습니다",
    severity: "error",
  },
  CONTRACT_METHOD_UNDOCUMENTED: {
    id: "CONTRACT_METHOD_UNDOCUMENTED",
    name: "Contract Method Undocumented",
    description: "Slot에 구현된 메서드가 Contract에 문서화되지 않았습니다",
    severity: "warning",
  },
  // Island-First Rendering rules
  ISLAND_FIRST_INTEGRITY: {
    id: "ISLAND_FIRST_INTEGRITY",
    name: "Island-First Integrity",
    description: "clientModule이 있는 page route의 componentModule이 island을 import하지 않습니다",
    severity: "error",
  },
  CLIENT_MODULE_NOT_FOUND: {
    id: "CLIENT_MODULE_NOT_FOUND",
    name: "Client Module Not Found",
    description: "spec에 명시된 clientModule 파일을 찾을 수 없습니다",
    severity: "error",
  },
  SLOT_DIR_INVALID_FILE: {
    id: "SLOT_DIR_INVALID_FILE",
    name: "Invalid File in Slots Directory",
    description: "spec/slots/ 디렉토리에 .slot.ts가 아닌 파일이 있습니다",
    severity: "error",
  },
  CONTRACT_DIR_INVALID_FILE: {
    id: "CONTRACT_DIR_INVALID_FILE",
    name: "Invalid File in Contracts Directory",
    description: "spec/contracts/ 디렉토리에 .contract.ts가 아닌 파일이 있습니다",
    severity: "error",
  },
};

export const FORBIDDEN_IMPORTS = ["fs", "child_process", "cluster", "worker_threads"];
