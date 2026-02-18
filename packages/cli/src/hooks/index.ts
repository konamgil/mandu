/**
 * DNA-016: CLI Hooks
 *
 * Command lifecycle hooks
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
