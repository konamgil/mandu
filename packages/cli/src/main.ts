#!/usr/bin/env bun

import { specUpsert } from "./commands/spec-upsert";
import { generateApply } from "./commands/generate-apply";
import { guardCheck } from "./commands/guard-check";
import { guardArch } from "./commands/guard-arch";
import { check } from "./commands/check";
import { dev } from "./commands/dev";
import { init } from "./commands/init";
import { build } from "./commands/build";
import { contractCreate, contractValidate, contractBuild, contractDiff } from "./commands/contract";
import { openAPIGenerate, openAPIServe } from "./commands/openapi";
import {
  changeBegin,
  changeCommit,
  changeRollback,
  changeStatus,
  changeList,
  changePrune,
} from "./commands/change";
import { doctor } from "./commands/doctor";
import { watch } from "./commands/watch";
import { brainSetup, brainStatus } from "./commands/brain";
import { routesGenerate, routesList, routesWatch } from "./commands/routes";
import { monitor } from "./commands/monitor";
import { CLI_ERROR_CODES, handleCLIError, printCLIError } from "./errors";

const HELP_TEXT = `
🥟 Mandu CLI - Agent-Native Fullstack Framework

Usage: bunx mandu <command> [options]

Commands:
  init              새 프로젝트 생성 (Tailwind + shadcn/ui 기본 포함)
  check             FS Routes + Guard 통합 검사
  routes generate   FS Routes 스캔 및 매니페스트 생성
  routes list       현재 라우트 목록 출력
  routes watch      실시간 라우트 감시
  dev               개발 서버 실행 (FS Routes + Guard 기본)
  build             클라이언트 번들 빌드 (Hydration)
  guard             아키텍처 위반 검사 (기본)
  guard arch        아키텍처 위반 검사 (FSD/Clean/Hexagonal)
  guard legacy      레거시 Spec Guard 검사
  spec-upsert       Spec 파일 검증 및 lock 갱신 (레거시)
  generate          Spec에서 코드 생성 (레거시)

  doctor            Guard 실패 분석 + 패치 제안 (Brain)
  watch             실시간 파일 감시 - 경고만 (Brain)
  monitor           MCP Activity Monitor 로그 스트림

  brain setup       sLLM 설정 (선택)
  brain status      Brain 상태 확인

  contract create <routeId>  라우트에 대한 Contract 생성
  contract validate          Contract-Slot 일관성 검증
  contract build             Contract 레지스트리 생성
  contract diff              Contract 변경사항 비교

  openapi generate           OpenAPI 3.0 스펙 생성
  openapi serve              Swagger UI 로컬 서버 실행

  change begin      변경 트랜잭션 시작 (스냅샷 생성)
  change commit     변경 확정
  change rollback   스냅샷으로 복원
  change status     현재 트랜잭션 상태
  change list       변경 이력 조회
  change prune      오래된 스냅샷 정리

Options:
  --name <name>       init 시 프로젝트 이름 (기본: my-mandu-app)
  --css <framework>   init 시 CSS 프레임워크: tailwind, panda, none (기본: tailwind)
  --ui <library>      init 시 UI 라이브러리: shadcn, ark, none (기본: shadcn)
  --theme             init 시 다크모드 테마 시스템 추가
  --minimal           init 시 CSS/UI 없이 최소 템플릿 생성 (--css none --ui none)
  --file <path>       spec-upsert spec 파일/monitor 로그 파일 경로
  --watch             build/guard arch 파일 감시 모드
  --output <path>     routes/openapi/doctor/contract/guard 출력 경로
  --verbose           routes list/watch, contract validate, brain status 상세 출력
  --from <path>       contract diff 기준 레지스트리 경로
  --to <path>         contract diff 대상 레지스트리 경로
  --json              contract diff 결과 JSON 출력
  --title <title>     openapi generate title
  --version <ver>     openapi generate version
  --summary           monitor 요약 출력 (JSON 로그에서만)
  --since <duration>  monitor 요약 기간 (예: 5m, 30s, 1h)
  --follow <bool>     monitor follow 모드 (기본: true)
  --message <msg>     change begin 시 설명 메시지
  --id <id>           change rollback 시 특정 변경 ID
  --keep <n>          change prune 시 유지할 스냅샷 수 (기본: 5)
  --no-llm            doctor에서 LLM 사용 안 함 (템플릿 모드)
  --status            watch 상태만 출력
  --debounce <ms>     watch debounce (ms)
  --model <name>      brain setup 시 모델 이름 (기본: llama3.2)
  --url <url>         brain setup 시 Ollama URL
  --skip-check        brain setup 시 모델/서버 체크 건너뜀
  --help, -h          도움말 표시

Notes:
  - 출력 포맷은 환경에 따라 자동 결정됩니다 (TTY/CI/MANDU_OUTPUT).
  - doctor 출력은 .json이면 JSON, 그 외는 markdown으로 저장됩니다.
  - guard arch 리포트는 .json/.html/.md 확장자를 자동 추론합니다.
  - 포트는 PORT 환경변수 또는 mandu.config의 server.port로 설정합니다.
  - 포트 충돌 시 다음 사용 가능한 포트로 자동 변경됩니다.

Examples:
  bunx mandu init --name my-app          # Tailwind + shadcn/ui 기본
  bunx mandu init my-app --minimal       # CSS/UI 없이 최소 템플릿
  bunx mandu dev
  bunx mandu build --watch
  bunx mandu guard
  bunx mandu guard arch --watch
  bunx mandu guard arch --output guard-report.md
  bunx mandu check
  bunx mandu routes list --verbose
  bunx mandu contract create users
  bunx mandu contract validate --verbose
  bunx mandu contract build --output .mandu/contracts.json
  bunx mandu contract diff --json
  bunx mandu openapi generate --output docs/openapi.json
  bunx mandu openapi serve
  bunx mandu monitor --summary --since 5m
  bunx mandu doctor --output reports/doctor.json
  bunx mandu brain setup --model codellama
  bunx mandu change begin --message "Add new route"

FS Routes Workflow (권장):
  1. init → 2. app/ 폴더에 page.tsx 생성 → 3. dev → 4. build

Legacy Workflow:
  1. init → 2. spec-upsert → 3. generate → 4. build → 5. guard → 6. dev

Contract-first Workflow:
  1. contract create → 2. Edit contract → 3. generate → 4. Edit slot → 5. contract validate

Brain (sLLM) Workflow:
  1. brain setup → 2. doctor (분석) → 3. watch (감시)
`;

function parseArgs(args: string[]): { command: string; options: Record<string, string> } {
  const command = args[0] || "";
  const options: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      options[key] = value;
    } else if (arg === "-h") {
      options["help"] = "true";
    } else if (!options._positional) {
      // First non-flag argument after command is positional (e.g., project name)
      options._positional = arg;
    }
  }

  return { command, options };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  if (options.help || command === "help" || !command) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  let success = true;

  switch (command) {
    case "init":
      success = await init({
        name: options.name || options._positional,
        css: options.css as any,
        ui: options.ui as any,
        theme: options.theme === "true",
        minimal: options.minimal === "true",
      });
      break;

    case "spec-upsert":
      success = await specUpsert({ file: options.file });
      break;

    case "generate":
      success = await generateApply();
      break;

    case "check":
      success = await check();
      break;

    case "guard": {
      const subCommand = args[1];
      const hasSubCommand = subCommand && !subCommand.startsWith("--");
      const guardArchOptions = {
        watch: options.watch === "true",
        output: options.output,
      };
      switch (subCommand) {
        case "arch":
          success = await guardArch(guardArchOptions);
          break;
        case "legacy":
        case "spec":
          success = await guardCheck();
          break;
        default:
          if (hasSubCommand) {
            printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
              command: "guard",
              subcommand,
            });
            console.log("\nUsage: bunx mandu guard <arch|legacy>");
            process.exit(1);
          }
          // 기본값: architecture guard
          success = await guardArch(guardArchOptions);
      }
      break;
    }

    case "build":
      success = await build({
        watch: options.watch === "true",
      });
      break;

    case "dev":
      await dev();
      break;

    case "routes": {
      const subCommand = args[1];
      switch (subCommand) {
        case "generate":
          success = await routesGenerate({
            output: options.output,
            verbose: options.verbose === "true",
          });
          break;
        case "list":
          success = await routesList({
            verbose: options.verbose === "true",
          });
          break;
        case "watch":
          success = await routesWatch({
            output: options.output,
            verbose: options.verbose === "true",
          });
          break;
        default:
          // 기본값: list
          if (!subCommand) {
            success = await routesList({
              verbose: options.verbose === "true",
            });
          } else {
            printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
              command: "routes",
              subcommand,
            });
            console.log("\nUsage: bunx mandu routes <generate|list|watch>");
            process.exit(1);
          }
      }
      break;
    }

    case "contract": {
      const subCommand = args[1];
      switch (subCommand) {
        case "create": {
          const routeId = args[2] || options._positional;
          if (!routeId) {
            printCLIError(CLI_ERROR_CODES.MISSING_ARGUMENT, { argument: "routeId" });
            console.log("\nUsage: bunx mandu contract create <routeId>");
            process.exit(1);
          }
          success = await contractCreate({ routeId });
          break;
        }
        case "validate":
          success = await contractValidate({ verbose: options.verbose === "true" });
          break;
        case "build":
          success = await contractBuild({ output: options.output });
          break;
        case "diff":
          success = await contractDiff({
            from: options.from,
            to: options.to,
            output: options.output,
            json: options.json === "true",
          });
          break;
        default:
          printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
            command: "contract",
            subcommand,
          });
          console.log("\nUsage: bunx mandu contract <create|validate|build|diff>");
          process.exit(1);
      }
      break;
    }

    case "openapi": {
      const subCommand = args[1];
      switch (subCommand) {
        case "generate":
          success = await openAPIGenerate({
            output: options.output,
            title: options.title,
            version: options.version,
          });
          break;
        case "serve":
          success = await openAPIServe();
          break;
        default:
          printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
            command: "openapi",
            subcommand,
          });
          console.log("\nUsage: bunx mandu openapi <generate|serve>");
          process.exit(1);
      }
      break;
    }

    case "change": {
      const subCommand = args[1];
      switch (subCommand) {
        case "begin":
          success = await changeBegin({ message: options.message });
          break;
        case "commit":
          success = await changeCommit();
          break;
        case "rollback":
          success = await changeRollback({ id: options.id });
          break;
        case "status":
          success = await changeStatus();
          break;
        case "list":
          success = await changeList();
          break;
        case "prune":
          success = await changePrune({
            keep: options.keep ? Number(options.keep) : undefined,
          });
          break;
        default:
          printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
            command: "change",
            subcommand,
          });
          console.log(`\nUsage: bunx mandu change <begin|commit|rollback|status|list|prune>`);
          process.exit(1);
      }
      break;
    }

    case "doctor":
      success = await doctor({
        useLLM: options["no-llm"] !== "true",
        output: options.output,
      });
      break;

    case "watch":
      success = await watch({
        status: options.status === "true",
        debounce: options.debounce ? Number(options.debounce) : undefined,
      });
      break;

    case "monitor":
      success = await monitor({
        summary: options.summary === "true",
        since: options.since,
        follow: options.follow === "false" ? false : true,
        file: options.file,
      });
      break;

    case "brain": {
      const subCommand = args[1];
      switch (subCommand) {
        case "setup":
          success = await brainSetup({
            model: options.model,
            url: options.url,
            skipCheck: options["skip-check"] === "true",
          });
          break;
        case "status":
          success = await brainStatus({
            verbose: options.verbose === "true",
          });
          break;
        default:
          printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
            command: "brain",
            subcommand,
          });
          console.log("\nUsage: bunx mandu brain <setup|status>");
          process.exit(1);
      }
      break;
    }

    default:
      printCLIError(CLI_ERROR_CODES.UNKNOWN_COMMAND, { command });
      console.log(HELP_TEXT);
      process.exit(1);
  }

  if (!success) {
    process.exit(1);
  }
}

main().catch((error) => handleCLIError(error));
