#!/usr/bin/env bun

import { specUpsert } from "./commands/spec-upsert";
import { generateApply } from "./commands/generate-apply";
import { guardCheck } from "./commands/guard-check";
import { guardArch } from "./commands/guard-arch";
import { check } from "./commands/check";
import { dev } from "./commands/dev";
import { init } from "./commands/init";
import { build } from "./commands/build";
import { contractCreate, contractValidate } from "./commands/contract";
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

const HELP_TEXT = `
🥟 Mandu CLI - Agent-Native Fullstack Framework

Usage: bunx mandu <command> [options]

Commands:
  init           새 프로젝트 생성
  check          FS Routes + Guard 통합 검사
  routes generate  FS Routes 스캔 및 매니페스트 생성
  routes list      현재 라우트 목록 출력
  routes watch     실시간 라우트 감시
  dev            개발 서버 실행 (FS Routes + Guard 기본)
  dev --no-guard Guard 감시 비활성화
  build          클라이언트 번들 빌드 (Hydration)
  guard          Guard 규칙 검사 (레거시 Spec 기반)
  guard arch     아키텍처 위반 검사 (FSD/Clean/Hexagonal)
  guard arch --watch  실시간 아키텍처 감시
  guard arch --list-presets  사용 가능한 프리셋 목록
  guard arch --output report.md  리포트 파일 생성
  guard arch --show-trend  트렌드 분석 표시
  spec-upsert    Spec 파일 검증 및 lock 갱신 (레거시)
  generate       Spec에서 코드 생성 (레거시)

  doctor         Guard 실패 분석 + 패치 제안 (Brain)
  watch          실시간 파일 감시 - 경고만 (Brain)

  brain setup    sLLM 설정 (선택)
  brain status   Brain 상태 확인

  contract create <routeId>  라우트에 대한 Contract 생성
  contract validate          Contract-Slot 일관성 검증

  openapi generate           OpenAPI 3.0 스펙 생성
  openapi serve              Swagger UI 로컬 서버 실행

  change begin   변경 트랜잭션 시작 (스냅샷 생성)
  change commit  변경 확정
  change rollback 스냅샷으로 복원
  change status  현재 트랜잭션 상태
  change list    변경 이력 조회
  change prune   오래된 스냅샷 정리

Options:
  --name <name>      init 시 프로젝트 이름 (기본: my-mandu-app)
  --file <path>      spec-upsert 시 사용할 spec 파일 경로
  --port <port>      dev/openapi serve 포트 (기본: 3000/8080)
  --guard            dev 시 Architecture Guard 실시간 감시 활성화 (기본: ON)
  --no-guard         dev 시 Guard 비활성화
  --guard-preset <p> dev --guard 시 프리셋 (기본: mandu)
  --guard-format <f> dev --guard 출력 형식: console, json, agent (기본: 자동)
  --legacy           FS Routes 비활성화 (레거시 모드)
  --no-auto-correct  guard 시 자동 수정 비활성화
  --preset <name>    guard/check 프리셋 (기본: mandu) - fsd, clean, hexagonal, atomic 선택 가능
  --ci               guard/check CI 모드 (에러 시 exit 1)
  --quiet            guard/check 요약만 출력
  --report-format    guard arch 리포트 형식: json, markdown, html
  --save-stats       guard arch 통계 저장 (트렌드 분석용)
  --show-trend       guard arch 트렌드 분석 표시
  --minify           build 시 코드 압축
  --sourcemap        build 시 소스맵 생성
  --watch            build/guard arch 파일 감시 모드
  --message <msg>    change begin 시 설명 메시지
  --id <id>          change rollback 시 특정 변경 ID
  --keep <n>         change prune 시 유지할 스냅샷 수 (기본: 5)
  --output <path>    openapi/doctor 출력 경로
  --format <fmt>     doctor/guard/check 출력 형식: console, json, agent (기본: 자동)
  --no-llm           doctor에서 LLM 사용 안 함 (템플릿 모드)
  --model <name>     brain setup 시 모델 이름 (기본: llama3.2)
  --url <url>        brain setup 시 Ollama URL
  --verbose          상세 출력
  --help, -h         도움말 표시

Examples:
  bunx mandu init --name my-app
  bunx mandu check
  bunx mandu routes list
  bunx mandu routes generate
  bunx mandu dev --port 3000
  bunx mandu dev --no-guard
  bunx mandu build --minify
  bunx mandu guard
  bunx mandu guard arch --preset fsd
  bunx mandu guard arch --watch
  bunx mandu guard arch --ci --format json
  bunx mandu doctor
  bunx mandu brain setup --model codellama
  bunx mandu contract create users
  bunx mandu openapi generate --output docs/api.json
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

/**
 * 포트 옵션 안전하게 파싱
 * - 숫자가 아니면 undefined 반환 (기본값 사용)
 * - 유효 범위: 1-65535
 */
function parsePort(value: string | undefined, optionName = "port"): number | undefined {
  if (!value || value === "true") {
    return undefined; // 기본값 사용
  }

  const port = Number(value);

  if (Number.isNaN(port)) {
    console.warn(`⚠️  Invalid --${optionName} value: "${value}" (using default)`);
    return undefined;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(`⚠️  Invalid --${optionName} range: ${port} (must be 1-65535, using default)`);
    return undefined;
  }

  return port;
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
        name: options.name || options._positional
      });
      break;

    case "spec-upsert":
      success = await specUpsert({ file: options.file });
      break;

    case "generate":
      success = await generateApply();
      break;

    case "check":
      success = await check({
        preset: options.preset as any,
        format: options.format as any,
        ci: options.ci === "true",
        quiet: options.quiet === "true",
        legacy: options.legacy === "true",
      });
      break;

    case "guard": {
      const subCommand = args[1];
      switch (subCommand) {
        case "arch":
          success = await guardArch({
            preset: (options.preset as any) || "fsd",
            watch: options.watch === "true",
            ci: options.ci === "true",
            format: options.format as any,
            quiet: options.quiet === "true",
            srcDir: options["src-dir"],
            listPresets: options["list-presets"] === "true",
            output: options.output,
            reportFormat: (options["report-format"] as any) || "markdown",
            saveStats: options["save-stats"] === "true",
            showTrend: options["show-trend"] === "true",
          });
          break;
        default:
          // 기본값: 레거시 guard-check
          success = await guardCheck({
            autoCorrect: options["no-auto-correct"] !== "true",
          });
      }
      break;
    }

    case "build":
      success = await build({
        minify: options.minify === "true",
        sourcemap: options.sourcemap === "true",
        watch: options.watch === "true",
      });
      break;

    case "dev":
      await dev({
        port: parsePort(options.port),
        guard: options["no-guard"] === "true" ? false : options.guard !== "false",
        guardPreset: options["guard-preset"] as any,
        guardFormat: options["guard-format"] as any,
        legacy: options.legacy === "true",
      });
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
            console.error(`❌ Unknown routes subcommand: ${subCommand}`);
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
            console.error("❌ Route ID is required");
            console.log("\nUsage: bunx mandu contract create <routeId>");
            process.exit(1);
          }
          success = await contractCreate({ routeId });
          break;
        }
        case "validate":
          success = await contractValidate({ verbose: options.verbose === "true" });
          break;
        default:
          console.error(`❌ Unknown contract subcommand: ${subCommand}`);
          console.log("\nUsage: bunx mandu contract <create|validate>");
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
          success = await openAPIServe({
            port: parsePort(options.port),
          });
          break;
        default:
          console.error(`❌ Unknown openapi subcommand: ${subCommand}`);
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
          console.error(`❌ Unknown change subcommand: ${subCommand}`);
          console.log(`\nUsage: bunx mandu change <begin|commit|rollback|status|list|prune>`);
          process.exit(1);
      }
      break;
    }

    case "doctor":
      success = await doctor({
        format: (options.format as "console" | "json" | "markdown") || "console",
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
          console.error(`❌ Unknown brain subcommand: ${subCommand}`);
          console.log("\nUsage: bunx mandu brain <setup|status>");
          process.exit(1);
      }
      break;
    }

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log(HELP_TEXT);
      process.exit(1);
  }

  if (!success) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ 예상치 못한 오류:", error);
  process.exit(1);
});
