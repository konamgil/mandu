#!/usr/bin/env bun

import { specUpsert } from "./commands/spec-upsert";
import { generateApply } from "./commands/generate-apply";
import { guardCheck } from "./commands/guard-check";
import { dev } from "./commands/dev";
import { init } from "./commands/init";
import { build } from "./commands/build";
import {
  changeBegin,
  changeCommit,
  changeRollback,
  changeStatus,
  changeList,
  changePrune,
} from "./commands/change";

const HELP_TEXT = `
🥟 Mandu CLI - Agent-Native Fullstack Framework

Usage: bunx mandu <command> [options]

Commands:
  init           새 프로젝트 생성
  spec-upsert    Spec 파일 검증 및 lock 갱신
  generate       Spec에서 코드 생성
  guard          Guard 규칙 검사
  build          클라이언트 번들 빌드 (Hydration)
  dev            개발 서버 실행

  change begin   변경 트랜잭션 시작 (스냅샷 생성)
  change commit  변경 확정
  change rollback 스냅샷으로 복원
  change status  현재 트랜잭션 상태
  change list    변경 이력 조회
  change prune   오래된 스냅샷 정리

Options:
  --name <name>      init 시 프로젝트 이름 (기본: my-mandu-app)
  --file <path>      spec-upsert 시 사용할 spec 파일 경로
  --port <port>      dev 서버 포트 (기본: 3000)
  --no-auto-correct  guard 시 자동 수정 비활성화
  --minify           build 시 코드 압축
  --sourcemap        build 시 소스맵 생성
  --watch            build 시 파일 감시 모드
  --message <msg>    change begin 시 설명 메시지
  --id <id>          change rollback 시 특정 변경 ID
  --keep <n>         change prune 시 유지할 스냅샷 수 (기본: 5)
  --help, -h         도움말 표시

Examples:
  bunx mandu init --name my-app
  bunx mandu spec-upsert
  bunx mandu generate
  bunx mandu guard
  bunx mandu build --minify
  bunx mandu build --watch
  bunx mandu dev --port 3000
  bunx mandu change begin --message "Add new route"
  bunx mandu change commit
  bunx mandu change rollback

Workflow:
  1. init → 2. spec-upsert → 3. generate → 4. build → 5. guard → 6. dev
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
        name: options.name || options._positional
      });
      break;

    case "spec-upsert":
      success = await specUpsert({ file: options.file });
      break;

    case "generate":
      success = await generateApply();
      break;

    case "guard":
      success = await guardCheck({
        autoCorrect: options["no-auto-correct"] !== "true",
      });
      break;

    case "build":
      success = await build({
        minify: options.minify === "true",
        sourcemap: options.sourcemap === "true",
        watch: options.watch === "true",
      });
      break;

    case "dev":
      await dev({ port: options.port ? Number(options.port) : undefined });
      break;

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
