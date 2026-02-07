/**
 * DNA-016: CLI Hooks
 *
 * 명령어 라이프사이클 훅
 */

export {
  preActionRegistry,
  runPreAction,
  registerPreActionHook,
  registerDefaultHooks,
  setVerbose,
  isVerbose,
  setProcessTitle,
  type PreActionContext,
  type PreActionHook,
} from "./preaction.js";
