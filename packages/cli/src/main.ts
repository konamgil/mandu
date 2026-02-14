#!/usr/bin/env bun

/**
 * Mandu CLI - Agent-Native Fullstack Framework
 *
 * DNA-010: Command Registry Pattern 적용
 * - 선언적 명령어 등록
 * - 레이지 로딩으로 시작 시간 최적화
 */

import { commandRegistry, getCommand, type CommandContext } from "./commands/registry";
import { CLI_ERROR_CODES, handleCLIError, printCLIError } from "./errors";
import { shouldShowBanner, renderHeroBanner, theme } from "./terminal";

const VERSION = "0.10.0";

const HELP_TEXT = `
${theme.heading("🥟 Mandu CLI")} ${theme.muted(`v${VERSION}`)} - Agent-Native Fullstack Framework

${theme.heading("Usage:")} ${theme.command("bunx mandu")} ${theme.option("<command>")} [options]

Commands:
  init              새 프로젝트 생성 (Tailwind + shadcn/ui 기본 포함)
  check             FS Routes + Guard 통합 검사
  routes generate   FS Routes 스캔 및 매니페스트 생성
  routes list       현재 라우트 목록 출력
  routes watch      실시간 라우트 감시
  dev               개발 서버 실행 (FS Routes + Guard 기본)
  build             클라이언트 번들 빌드 (Hydration)
  start             프로덕션 서버 실행 (build 후)
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

  lock              Lockfile 생성/갱신
  lock --verify     Lockfile 검증 (설정 무결성 확인)
  lock --diff       Lockfile과 현재 설정 비교

  add test          ATE 설치 + Playwright 브라우저 준비
  test:auto         ATE extract→generate→run→report
  test:auto --ci    CI 모드(headless/아티팩트 강화)
  test:auto --impact  변경 파일 기반 subset 실행
  test:auto --base-url <url>  대상 서버 baseURL 지정 (기본: http://localhost:3333)
  test:heal         최근 실패 기반 healing 제안 생성(자동 커밋 금지)

Options:
  --name <name>       init 시 프로젝트 이름 (기본: my-mandu-app)
  --template <name>   init 템플릿: default, realtime-chat (기본: default)
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
  --verify, -v        lock 시 lockfile 검증만 수행
  --diff, -d          lock 시 lockfile과 현재 설정 비교
  --show-secrets      lock diff 시 민감정보 출력 허용
  --include-snapshot  lock 시 설정 스냅샷 포함 (diff 기능에 필요)
  --mode <mode>       lock verify 시 모드 (development|build|ci|production)
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
  bunx mandu init --name my-app                        # Tailwind + shadcn/ui 기본
  bunx mandu init --name chat-app --template realtime-chat  # 실시간 채팅 스타터 템플릿
  bunx mandu init my-app --minimal                     # CSS/UI 없이 최소 템플릿
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
  bunx mandu lock                          # Lockfile 생성/갱신
  bunx mandu lock --verify                 # 설정 무결성 검증
  bunx mandu lock --diff --show-secrets    # 변경사항 상세 비교

FS Routes Workflow (권장):
  1. init → 2. app/ 폴더에 page.tsx 생성 → 3. dev → 4. build → 5. start

Legacy Workflow:
  1. init → 2. spec-upsert → 3. generate → 4. build → 5. guard → 6. dev

Contract-first Workflow:
  1. contract create → 2. Edit contract → 3. generate → 4. Edit slot → 5. contract validate

Brain (sLLM) Workflow:
  1. brain setup → 2. doctor (분석) → 3. watch (감시)
`;

/**
 * 인자 파싱
 */
export function parseArgs(args: string[]): { command: string; options: Record<string, string> } {
  const options: Record<string, string> = {};
  let command = "";
  const shortFlags: Record<string, string> = {
    h: "help",
    q: "quiet",
    v: "verify",
    d: "diff",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // 플래그 처리
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      options[key] = value;
    } else if (arg.startsWith("-") && arg.length > 1) {
      const flags = arg.slice(1).split("");
      for (const flag of flags) {
        const mapped = shortFlags[flag];
        if (mapped) {
          options[mapped] = "true";
        } else {
          options[flag] = "true";
        }
      }
    } else if (!command) {
      // 첫 번째 비플래그 인자가 명령어
      command = arg;
    } else if (!options._positional) {
      // 두 번째 비플래그 인자가 positional
      options._positional = arg;
    }
  }

  return { command, options };
}

/**
 * 메인 함수
 */
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { command, options } = parseArgs(args);

  // 도움말 처리
  if (options.help || command === "help" || !command) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // 히어로 배너 표시
  if (shouldShowBanner(args)) {
    await renderHeroBanner(VERSION);
  }

  // DNA-010: 레지스트리에서 명령어 조회
  const registration = getCommand(command);

  if (!registration) {
    printCLIError(CLI_ERROR_CODES.UNKNOWN_COMMAND, { command });
    console.log(HELP_TEXT);
    process.exit(1);
  }

  // 명령어 실행 컨텍스트
  const ctx: CommandContext = { args, options };

  // 명령어 실행
  const success = await registration.run(ctx);

  // 서브커맨드 에러 처리
  if (!success) {
    const subCommand = args[1];
    if (registration.subcommands && subCommand && !subCommand.startsWith("--")) {
      // 알 수 없는 서브커맨드
      printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
        command,
        subcommand: subCommand,
      });
      console.log(`\nUsage: bunx mandu ${command} <${registration.subcommands.join("|")}>`);
    } else if (registration.subcommands) {
      // 서브커맨드 필요
      printCLIError(CLI_ERROR_CODES.MISSING_ARGUMENT, {
        argument: "subcommand",
      });
      console.log(`\nUsage: bunx mandu ${command} <${registration.subcommands.join("|")}>`);
    }
    process.exit(1);
  }

}

if (import.meta.main) {
  main().catch((error) => handleCLIError(error));
}
