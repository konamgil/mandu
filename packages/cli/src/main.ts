#!/usr/bin/env bun

import { specUpsert } from "./commands/spec-upsert";
import { generateApply } from "./commands/generate-apply";
import { guardCheck } from "./commands/guard-check";
import { dev } from "./commands/dev";
import { init } from "./commands/init";

const HELP_TEXT = `
🥟 Mandu CLI - Agent-Native Fullstack Framework

Usage: bunx mandu <command> [options]

Commands:
  init           새 프로젝트 생성
  spec-upsert    Spec 파일 검증 및 lock 갱신
  generate       Spec에서 코드 생성
  guard          Guard 규칙 검사
  dev            개발 서버 실행

Options:
  --name <name>      init 시 프로젝트 이름 (기본: my-mandu-app)
  --file <path>      spec-upsert 시 사용할 spec 파일 경로
  --port <port>      dev 서버 포트 (기본: 3000)
  --no-auto-correct  guard 시 자동 수정 비활성화
  --help, -h         도움말 표시

Examples:
  bunx mandu init --name my-app
  bunx mandu spec-upsert
  bunx mandu generate
  bunx mandu guard
  bunx mandu dev --port 3000

Workflow:
  1. init → 2. spec-upsert → 3. generate → 4. guard → 5. dev
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

    case "dev":
      await dev({ port: options.port ? Number(options.port) : undefined });
      break;

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
