/**
 * Slot Module
 * 슬롯 파일 검증 및 자동 수정 기능
 */

export {
  validateSlotContent,
  summarizeValidationIssues,
  type SlotValidationIssue,
  type SlotValidationResult,
} from "./validator";

export {
  correctSlotContent,
  runSlotCorrection,
  type CorrectionResult,
  type AppliedFix,
} from "./corrector";
