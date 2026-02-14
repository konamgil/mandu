/**
 * DNA-010: Command Registry Pattern
 *
 * 선언적 명령어 등록 시스템
 * - 각 명령어를 독립적으로 정의
 * - 레이지 로딩으로 시작 시간 최적화
 * - 서브커맨드 자동 라우팅
 */

import type { CLI_ERROR_CODES } from "../errors";

/**
 * 명령어 실행 컨텍스트
 */
export interface CommandContext {
  args: string[];
  options: Record<string, string>;
}

/**
 * 명령어 등록 정의
 */
export interface CommandRegistration {
  /** 명령어 ID (예: "dev", "build", "guard") */
  id: string;
  /** 명령어 설명 */
  description: string;
  /** 서브커맨드 목록 (예: guard의 "arch", "legacy") */
  subcommands?: string[];
  /** 기본 서브커맨드 (서브커맨드 없이 호출 시) */
  defaultSubcommand?: string;
  /** 명령어 실행 */
  run: (ctx: CommandContext) => Promise<boolean>;
}

/**
 * 명령어 레지스트리
 */
export const commandRegistry = new Map<string, CommandRegistration>();

/**
 * 명령어 등록
 */
export function registerCommand(registration: CommandRegistration): void {
  commandRegistry.set(registration.id, registration);
}

/**
 * 명령어 조회
 */
export function getCommand(id: string): CommandRegistration | undefined {
  return commandRegistry.get(id);
}

/**
 * 모든 명령어 ID 목록
 */
export function getAllCommands(): string[] {
  return Array.from(commandRegistry.keys());
}

// ============================================================================
// 명령어 등록 (레이지 로딩)
// ============================================================================

registerCommand({
  id: "init",
  description: "새 프로젝트 생성 (Tailwind + shadcn/ui 기본 포함)",
  async run(ctx) {
    const { init } = await import("./init");
    return init({
      name: ctx.options.name || ctx.options._positional,
      template: ctx.options.template,
      css: ctx.options.css as any,
      ui: ctx.options.ui as any,
      theme: ctx.options.theme === "true",
      minimal: ctx.options.minimal === "true",
    });
  },
});

registerCommand({
  id: "dev",
  description: "개발 서버 실행 (FS Routes + Guard 기본)",
  async run() {
    const { dev } = await import("./dev");
    await dev();
    return true;
  },
});

registerCommand({
  id: "build",
  description: "클라이언트 번들 빌드 (Hydration)",
  async run(ctx) {
    const { build } = await import("./build");
    return build({ watch: ctx.options.watch === "true" });
  },
});

registerCommand({
  id: "start",
  description: "프로덕션 서버 실행 (build 후)",
  async run() {
    const { start } = await import("./start");
    await start();
    return true;
  },
});

registerCommand({
  id: "check",
  description: "FS Routes + Guard 통합 검사",
  async run() {
    const { check } = await import("./check");
    return check();
  },
});

registerCommand({
  id: "guard",
  description: "아키텍처 위반 검사",
  subcommands: ["arch", "legacy", "spec"],
  defaultSubcommand: "arch",
  async run(ctx) {
    const subCommand = ctx.args[1];
    const hasSubCommand = subCommand && !subCommand.startsWith("--");

    const guardOptions = {
      watch: ctx.options.watch === "true",
      output: ctx.options.output,
    };

    switch (subCommand) {
      case "arch": {
        const { guardArch } = await import("./guard-arch");
        return guardArch(guardOptions);
      }
      case "legacy":
      case "spec": {
        const { guardCheck } = await import("./guard-check");
        return guardCheck();
      }
      default:
        if (hasSubCommand) {
          // 알 수 없는 서브커맨드는 main.ts에서 처리
          return false;
        }
        // 기본값: architecture guard
        const { guardArch } = await import("./guard-arch");
        return guardArch(guardOptions);
    }
  },
});

registerCommand({
  id: "routes",
  description: "FS Routes 관리",
  subcommands: ["generate", "list", "watch"],
  defaultSubcommand: "list",
  async run(ctx) {
    const subCommand = ctx.args[1];
    const { routesGenerate, routesList, routesWatch } = await import("./routes");

    const routesOptions = {
      output: ctx.options.output,
      verbose: ctx.options.verbose === "true",
    };

    switch (subCommand) {
      case "generate":
        return routesGenerate(routesOptions);
      case "list":
        return routesList({ verbose: routesOptions.verbose });
      case "watch":
        return routesWatch(routesOptions);
      default:
        if (subCommand && !subCommand.startsWith("--")) {
          return false; // 알 수 없는 서브커맨드
        }
        return routesList({ verbose: routesOptions.verbose });
    }
  },
});

registerCommand({
  id: "contract",
  description: "Contract-First API 개발",
  subcommands: ["create", "validate", "build", "diff"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const {
      contractCreate,
      contractValidate,
      contractBuild,
      contractDiff,
    } = await import("./contract");

    switch (subCommand) {
      case "create": {
        const routeId = ctx.args[2] || ctx.options._positional;
        if (!routeId) return false;
        return contractCreate({ routeId });
      }
      case "validate":
        return contractValidate({ verbose: ctx.options.verbose === "true" });
      case "build":
        return contractBuild({ output: ctx.options.output });
      case "diff":
        return contractDiff({
          from: ctx.options.from,
          to: ctx.options.to,
          output: ctx.options.output,
          json: ctx.options.json === "true",
        });
      default:
        return false;
    }
  },
});

registerCommand({
  id: "openapi",
  description: "OpenAPI 스펙 생성",
  subcommands: ["generate", "serve"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const { openAPIGenerate, openAPIServe } = await import("./openapi");

    switch (subCommand) {
      case "generate":
        return openAPIGenerate({
          output: ctx.options.output,
          title: ctx.options.title,
          version: ctx.options.version,
        });
      case "serve":
        return openAPIServe();
      default:
        return false;
    }
  },
});

registerCommand({
  id: "change",
  description: "변경 트랜잭션 관리",
  subcommands: ["begin", "commit", "rollback", "status", "list", "prune"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const {
      changeBegin,
      changeCommit,
      changeRollback,
      changeStatus,
      changeList,
      changePrune,
    } = await import("./change");

    switch (subCommand) {
      case "begin":
        return changeBegin({ message: ctx.options.message });
      case "commit":
        return changeCommit();
      case "rollback":
        return changeRollback({ id: ctx.options.id });
      case "status":
        return changeStatus();
      case "list":
        return changeList();
      case "prune":
        return changePrune({
          keep: ctx.options.keep ? Number(ctx.options.keep) : undefined,
        });
      default:
        return false;
    }
  },
});

registerCommand({
  id: "brain",
  description: "Brain (sLLM) 관리",
  subcommands: ["setup", "status"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const { brainSetup, brainStatus } = await import("./brain");

    switch (subCommand) {
      case "setup":
        return brainSetup({
          model: ctx.options.model,
          url: ctx.options.url,
          skipCheck: ctx.options["skip-check"] === "true",
        });
      case "status":
        return brainStatus({ verbose: ctx.options.verbose === "true" });
      default:
        return false;
    }
  },
});

registerCommand({
  id: "doctor",
  description: "Guard 실패 분석 + 패치 제안",
  async run(ctx) {
    const { doctor } = await import("./doctor");
    return doctor({
      useLLM: ctx.options["no-llm"] !== "true",
      output: ctx.options.output,
    });
  },
});

registerCommand({
  id: "watch",
  description: "실시간 파일 감시",
  async run(ctx) {
    const { watch } = await import("./watch");
    return watch({
      status: ctx.options.status === "true",
      debounce: ctx.options.debounce ? Number(ctx.options.debounce) : undefined,
    });
  },
});

registerCommand({
  id: "monitor",
  description: "MCP Activity Monitor",
  async run(ctx) {
    const { monitor } = await import("./monitor");
    return monitor({
      summary: ctx.options.summary === "true",
      since: ctx.options.since,
      follow: ctx.options.follow === "false" ? false : true,
      file: ctx.options.file,
    });
  },
});

registerCommand({
  id: "lock",
  description: "Lockfile 관리",
  async run(ctx) {
    const { runLockCommand } = await import("./lock");
    return runLockCommand(ctx.args.slice(1));
  },
});

// ============================================================================
// ATE (Automation Test Engine)
// ============================================================================

registerCommand({
  id: "add",
  description: "프로젝트에 기능 추가",
  subcommands: ["test"],
  async run(ctx) {
    const sub = ctx.args[1];
    if (sub !== "test") return false;
    const { addTest } = await import("./add");
    return addTest({ cwd: process.cwd() });
  },
});

registerCommand({
  id: "test:auto",
  description: "ATE 자동 E2E 생성/실행",
  async run(ctx) {
    const { testAuto } = await import("./test-auto");
    return testAuto({
      ci: ctx.options.ci === "true",
      impact: ctx.options.impact === "true",
      baseURL: ctx.options["base-url"] || ctx.options.baseURL || ctx.options.baseUrl,

      dev: ctx.options.dev,
      start: ctx.options.start,
      stop: ctx.options.stop,
      healthPath: ctx.options["health-path"] || ctx.options.healthPath,
      readyTimeoutMs: ctx.options["ready-timeout"] ? Number(ctx.options["ready-timeout"]) : undefined,
      reuseExisting: ctx.options["reuse-existing"] === "true",
    });
  },
});

registerCommand({
  id: "test:heal",
  description: "ATE healing 제안 생성(자동 커밋 금지)",
  async run() {
    const { testHeal } = await import("./test-heal");
    return testHeal();
  },
});


// 레거시 명령어 (DEPRECATED)
registerCommand({
  id: "spec-upsert",
  description: "[DEPRECATED] Spec 파일 검증 및 lock 갱신 → routes generate 사용",
  async run(ctx) {
    const { specUpsert } = await import("./spec-upsert");
    return specUpsert({ file: ctx.options.file });
  },
});

registerCommand({
  id: "generate",
  description: "FS Routes 기반 코드 생성",
  async run() {
    const { generateApply } = await import("./generate-apply");
    return generateApply();
  },
});
