import path from "path";
import fs from "fs/promises";
import { CLI_ERROR_CODES, printCLIError } from "../errors";
import {
  generateLockfile,
  writeLockfile,
  LOCKFILE_PATH,
} from "@mandujs/core";

export type CSSFramework = "tailwind" | "panda" | "none";
export type UILibrary = "shadcn" | "ark" | "none";

export interface InitOptions {
  name?: string;
  template?: string;
  css?: CSSFramework;
  ui?: UILibrary;
  theme?: boolean;
  minimal?: boolean;
}

const ALLOWED_TEMPLATES = ["default", "realtime-chat"] as const;
type AllowedTemplate = (typeof ALLOWED_TEMPLATES)[number];

export function isAllowedTemplate(template: string): template is AllowedTemplate {
  return (ALLOWED_TEMPLATES as readonly string[]).includes(template);
}

function resolveTemplateName(template: string): AllowedTemplate | null {
  const normalized = path.posix.normalize(template.replace(/\\/g, "/")).trim();
  if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
    return null;
  }
  return isAllowedTemplate(normalized) ? normalized : null;
}

// Files to skip based on CSS/UI options
const CSS_FILES = [
  "tailwind.config.ts",
  "postcss.config.js",
  "app/globals.css",
];

const UI_FILES = [
  "src/client/shared/ui/button.tsx",
  "src/client/shared/ui/card.tsx",
  "src/client/shared/ui/input.tsx",
  "src/client/shared/ui/index.ts",
  "src/client/shared/lib/utils.ts",
];

interface CopyOptions {
  projectName: string;
  css: CSSFramework;
  ui: UILibrary;
  theme: boolean;
  coreVersion: string;
  cliVersion: string;
}

function shouldSkipFile(relativePath: string, options: CopyOptions): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");

  // Skip CSS files if css is none
  if (options.css === "none") {
    if (CSS_FILES.some((f) => normalizedPath.endsWith(f))) {
      return true;
    }
  }

  // Skip UI files if ui is none
  if (options.ui === "none") {
    if (UI_FILES.some((f) => normalizedPath.endsWith(f))) {
      return true;
    }
    // Skip UI/shared directories
    if (normalizedPath.includes("src/client/shared/ui/")) return true;
    if (normalizedPath.includes("src/client/shared/lib/")) return true;
  }

  return false;
}

async function copyDir(
  src: string,
  dest: string,
  options: CopyOptions,
  relativePath = ""
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const currentRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      // Skip directories that would be empty when ui=none
      if (options.ui === "none") {
        if (entry.name === "ui" && relativePath === "src/client/shared") continue;
        if (entry.name === "lib" && relativePath === "src/client/shared") continue;
      }
      await copyDir(srcPath, destPath, options, currentRelativePath);
    } else {
      // Check if file should be skipped
      if (shouldSkipFile(currentRelativePath, options)) {
        continue;
      }

      let content = await fs.readFile(srcPath, "utf-8");
      // Replace template variables
      content = content.replace(/\{\{PROJECT_NAME\}\}/g, options.projectName);
      content = content.replace(/\{\{CORE_VERSION\}\}/g, options.coreVersion);
      content = content.replace(/\{\{CLI_VERSION\}\}/g, options.cliVersion);

      // Add dark mode CSS variables if theme is enabled
      if (options.theme && currentRelativePath === "app/globals.css") {
        content = addDarkModeCSS(content);
      }

      await fs.writeFile(destPath, content);
    }
  }
}

function addDarkModeCSS(content: string): string {
  const darkModeCSS = `
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }`;

  // Insert dark mode after :root block
  return content.replace(
    /(:root\s*\{[^}]+\})/,
    `$1\n${darkModeCSS}`
  );
}

function getTemplatesDir(): string {
  // When installed via npm, templates are in the CLI package
  const commandsDir = import.meta.dir;
  // packages/cli/src/commands -> go up 2 levels to cli package root
  return path.resolve(commandsDir, "../../templates");
}

/**
 * CLI/Core 패키지 버전을 런타임에 읽어서 ^major.minor.0 형태로 반환
 * 템플릿 package.json의 {{CORE_VERSION}}, {{CLI_VERSION}} 치환에 사용
 */
async function resolvePackageVersions(): Promise<{ coreVersion: string; cliVersion: string }> {
  const cliPkgPath = path.resolve(import.meta.dir, "../../package.json");
  const cliPkg = JSON.parse(await fs.readFile(cliPkgPath, "utf-8"));
  const cliVersion = cliPkg.version ?? "0.0.0";

  // core는 CLI의 node_modules 또는 workspace에서 읽기
  let coreVersion = cliVersion; // fallback: CLI 버전과 동일
  try {
    const corePkgPath = require.resolve("@mandujs/core/package.json", { paths: [path.resolve(import.meta.dir, "../..")] });
    const corePkg = JSON.parse(await fs.readFile(corePkgPath, "utf-8"));
    coreVersion = corePkg.version ?? coreVersion;
  } catch {
    // workspace 환경: 직접 경로로 시도
    try {
      const workspacePath = path.resolve(import.meta.dir, "../../../core/package.json");
      const corePkg = JSON.parse(await fs.readFile(workspacePath, "utf-8"));
      coreVersion = corePkg.version ?? coreVersion;
    } catch {
      // fallback 유지
    }
  }

  return {
    coreVersion: `^${coreVersion}`,
    cliVersion: `^${cliVersion}`,
  };
}

export async function init(options: InitOptions = {}): Promise<boolean> {
  const projectName = options.name || "my-mandu-app";
  const requestedTemplate = options.template || "default";
  const template = resolveTemplateName(requestedTemplate);
  const targetDir = path.resolve(process.cwd(), projectName);

  if (!template) {
    printCLIError(CLI_ERROR_CODES.INIT_TEMPLATE_NOT_FOUND, { template: requestedTemplate });
    console.error(`   사용 가능한 템플릿: ${ALLOWED_TEMPLATES.join(", ")}`);
    return false;
  }

  // Handle minimal flag (shortcut for --css none --ui none)
  const css: CSSFramework = options.minimal ? "none" : (options.css || "tailwind");
  const ui: UILibrary = options.minimal ? "none" : (options.ui || "shadcn");
  const theme = options.theme || false;

  console.log(`🥟 Mandu Init`);
  console.log(`📁 프로젝트: ${projectName}`);
  console.log(`📦 템플릿: ${template}`);
  console.log(`🎨 CSS: ${css}${css !== "none" ? " (Tailwind CSS)" : ""}`);
  console.log(`🧩 UI: ${ui}${ui !== "none" ? " (shadcn/ui)" : ""}`);
  if (theme) {
    console.log(`🌙 테마: Dark mode 지원`);
  }
  console.log();

  // Check if target directory exists
  try {
    await fs.access(targetDir);
    printCLIError(CLI_ERROR_CODES.INIT_DIR_EXISTS, { path: targetDir });
    return false;
  } catch {
    // Directory doesn't exist, good to proceed
  }

  const templatesDir = getTemplatesDir();
  const templateDir = path.join(templatesDir, template);

  // Check if template exists
  try {
    await fs.access(templateDir);
  } catch {
    printCLIError(CLI_ERROR_CODES.INIT_TEMPLATE_NOT_FOUND, { template });
    console.error(`   사용 가능한 템플릿: ${ALLOWED_TEMPLATES.join(", ")}`);
    return false;
  }

  console.log(`📋 템플릿 복사 중...`);

  const { coreVersion, cliVersion } = await resolvePackageVersions();

  const copyOptions: CopyOptions = {
    projectName,
    css,
    ui,
    theme,
    coreVersion,
    cliVersion,
  };

  try {
    await copyDir(templateDir, targetDir, copyOptions);
  } catch (error) {
    console.error(`❌ 템플릿 복사 실패:`, error);
    return false;
  }

  // Create .mandu directory for build output
  await fs.mkdir(path.join(targetDir, ".mandu/client"), { recursive: true });

  // Create minimal layout.tsx if css=none (without globals.css import)
  if (css === "none") {
    await createMinimalLayout(targetDir, projectName);
  }

  // Create minimal page.tsx if ui=none (without UI components)
  if (ui === "none") {
    await createMinimalPage(targetDir);
  }

  // Update package.json to remove unused dependencies
  if (css === "none" || ui === "none") {
    await updatePackageJson(targetDir, css, ui);
  }

  // Setup .mcp.json for AI agent integration
  const mcpResult = await setupMcpConfig(targetDir);

  // Generate initial lockfile for config integrity
  const lockfileResult = await setupLockfile(targetDir);

  console.log(`\n✅ 프로젝트 생성 완료!\n`);
  console.log(`📍 위치: ${targetDir}`);
  console.log(`\n🚀 시작하기:`);
  console.log(`   cd ${projectName}`);
  console.log(`   bun install`);
  console.log(`   bun run dev`);
  console.log(`\n💡 CLI 실행 참고 (환경별):`);
  console.log(`   bun run dev        # 권장 (로컬 스크립트)`);
  console.log(`   bunx mandu dev     # PATH에 mandu가 없을 때 대안`);
  console.log(`\n📂 파일 구조:`);
  console.log(`   app/layout.tsx    → 루트 레이아웃`);
  console.log(`   app/page.tsx      → http://localhost:3000/`);
  console.log(`   app/api/*/route.ts → API endpoints`);
  console.log(`   src/client/*      → 클라이언트 레이어`);
  console.log(`   src/server/*      → 서버 레이어`);
  console.log(`   src/shared/contracts → 계약 (client-safe)`);
  console.log(`   src/shared/types     → 공용 타입`);
  console.log(`   src/shared/utils/client → 클라이언트 safe 유틸`);
  console.log(`   src/shared/utils/server → 서버 전용 유틸`);
  console.log(`   src/shared/schema    → 서버 전용 스키마`);
  console.log(`   src/shared/env       → 서버 전용 환경`);
  if (css !== "none") {
    console.log(`   app/globals.css   → 전역 CSS (Tailwind v4)`);
  }
  if (ui !== "none") {
    console.log(`   src/client/shared/ui/ → UI 컴포넌트 (shadcn)`);
    console.log(`   src/client/shared/lib/utils.ts → 유틸리티 (cn 함수)`);
  }

  // MCP 설정 안내
  console.log(`\n🤖 AI 에이전트 통합:`);
  logMcpConfigStatus(".mcp.json", mcpResult.mcpJson, "Claude Code 자동 연결");
  logMcpConfigStatus(".claude.json", mcpResult.claudeJson, "Claude MCP 로컬 범위");
  console.log(`   AGENTS.md → 에이전트 가이드 (Bun 사용 명시)`);

  // Lockfile 안내
  console.log(`\n🔒 설정 무결성:`);
  if (lockfileResult.success) {
    console.log(`   ${LOCKFILE_PATH} 생성됨`);
    console.log(`   해시: ${lockfileResult.hash}`);
  } else {
    console.log(`   Lockfile 생성 건너뜀 (설정 없음)`);
  }

  return true;
}

async function createMinimalLayout(targetDir: string, projectName: string): Promise<void> {
  const layoutContent = `/**
 * Root Layout (Minimal)
 */

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${projectName}</title>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
`;
  await fs.writeFile(path.join(targetDir, "app/layout.tsx"), layoutContent);
}

async function createMinimalPage(targetDir: string): Promise<void> {
  const pageContent = `/**
 * Home Page (Minimal)
 *
 * Edit this file and see changes at http://localhost:3000
 */

export default function HomePage() {
  return (
    <main style={{
      display: "flex",
      minHeight: "100vh",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      padding: "2rem",
    }}>
      <div style={{
        textAlign: "center",
        color: "white",
      }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>🥟 Mandu</h1>
        <p style={{ fontSize: "1.2rem", opacity: 0.9 }}>
          Welcome to your new Mandu project!
        </p>
        <p style={{ fontSize: "1rem", opacity: 0.8, marginTop: "0.5rem" }}>
          Edit <code style={{
            background: "rgba(255,255,255,0.2)",
            padding: "0.2rem 0.5rem",
            borderRadius: "4px",
          }}>app/page.tsx</code> to get started.
        </p>
        <p style={{ marginTop: "1rem" }}>
          <a href="/api/health" style={{ color: "white" }}>API Health →</a>
        </p>
      </div>
    </main>
  );
}
`;
  await fs.writeFile(path.join(targetDir, "app/page.tsx"), pageContent);
}

async function updatePackageJson(
  targetDir: string,
  css: CSSFramework,
  ui: UILibrary
): Promise<void> {
  const pkgPath = path.join(targetDir, "package.json");
  const content = await fs.readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(content);

  if (css === "none") {
    // Remove Tailwind dependencies (v4)
    delete pkg.devDependencies?.tailwindcss;
    delete pkg.devDependencies?.["@tailwindcss/cli"];
    // Legacy v3 (just in case)
    delete pkg.devDependencies?.postcss;
    delete pkg.devDependencies?.autoprefixer;
  }

  if (ui === "none") {
    // Remove UI library dependencies
    delete pkg.dependencies?.["@radix-ui/react-slot"];
    delete pkg.dependencies?.["class-variance-authority"];
    delete pkg.dependencies?.clsx;
    delete pkg.dependencies?.["tailwind-merge"];
  }

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

type McpConfigStatus = "created" | "updated" | "unchanged" | "backed-up" | "error";

interface McpConfigFileResult {
  status: McpConfigStatus;
  backupPath?: string;
  error?: string;
}

interface McpConfigResult {
  mcpJson: McpConfigFileResult;
  claudeJson: McpConfigFileResult;
}

function logMcpConfigStatus(
  label: string,
  result: McpConfigFileResult,
  createdNote?: string
): void {
  if (result.status === "created") {
    console.log(`   ${label} 생성됨${createdNote ? ` (${createdNote})` : ""}`);
    return;
  }

  if (result.status === "updated") {
    console.log(`   ${label}에 mandu 서버 추가/업데이트됨`);
    return;
  }

  if (result.status === "unchanged") {
    console.log(`   ${label} 이미 최신`);
    return;
  }

  if (result.status === "backed-up") {
    console.log(`   ${label} 파싱 실패 → 백업 후 새로 생성됨`);
    if (result.backupPath) {
      console.log(`   백업: ${result.backupPath}`);
    }
    return;
  }

  if (result.status === "error") {
    console.log(`   ${label} 설정 실패: ${result.error}`);
  }
}

/**
 * .mcp.json / .claude.json 설정 (AI 에이전트 통합)
 * - 파일 없으면 새로 생성
 * - 파일 있으면 mandu 서버만 추가/업데이트 (다른 설정 유지)
 */
async function setupMcpConfig(targetDir: string): Promise<McpConfigResult> {
  const mcpPath = path.join(targetDir, ".mcp.json");
  const claudePath = path.join(targetDir, ".claude.json");

  const manduServer = {
    command: "bunx",
    args: ["@mandujs/mcp"],
    cwd: ".",
  };

  const updateMcpFile = async (filePath: string): Promise<McpConfigFileResult> => {
    const writeConfig = async (data: Record<string, unknown>) => {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
    };

    const fileExists = async (candidatePath: string) => {
      try {
        await fs.access(candidatePath);
        return true;
      } catch {
        return false;
      }
    };

    const getBackupPath = async (basePath: string) => {
      const base = `${basePath}.bak`;
      if (!(await fileExists(base))) {
        return base;
      }
      for (let i = 1; i <= 50; i++) {
        const candidate = `${basePath}.bak.${i}`;
        if (!(await fileExists(candidate))) {
          return candidate;
        }
      }
      return `${basePath}.bak.${Date.now()}`;
    };

    try {
      const existingContent = await fs.readFile(filePath, "utf-8");
      let existing: Record<string, unknown>;

      try {
        existing = JSON.parse(existingContent) as Record<string, unknown>;
      } catch {
        const backupPath = await getBackupPath(filePath);
        await fs.writeFile(backupPath, existingContent);
        await writeConfig({ mcpServers: { mandu: manduServer } });
        return { status: "backed-up", backupPath };
      }

      if (!existing || typeof existing !== "object") {
        existing = {};
      }

      if (!existing.mcpServers || typeof existing.mcpServers !== "object") {
        existing.mcpServers = {};
      }

      const current = (existing.mcpServers as Record<string, unknown>).mandu;
      const isSame =
        current && JSON.stringify(current) === JSON.stringify(manduServer);

      if (isSame) {
        return { status: "unchanged" };
      }

      (existing.mcpServers as Record<string, unknown>).mandu = manduServer;
      await writeConfig(existing);
      return { status: "updated" };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
        await writeConfig({ mcpServers: { mandu: manduServer } });
        return { status: "created" };
      }
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const mcpJson = await updateMcpFile(mcpPath);
  const claudeJson = await updateMcpFile(claudePath);

  return { mcpJson, claudeJson };
}

interface LockfileResult {
  success: boolean;
  hash?: string;
  error?: string;
}

/**
 * 초기 Lockfile 생성 (설정 무결성)
 */
async function setupLockfile(targetDir: string): Promise<LockfileResult> {
  try {
    // 초기 설정 (기본값)
    const initialConfig = {
      name: path.basename(targetDir),
      version: "0.1.0",
      createdAt: new Date().toISOString(),
    };

    const lockfile = generateLockfile(initialConfig, {
      includeSnapshot: true,
      includeMcpServerHashes: false,
    });

    await writeLockfile(targetDir, lockfile);

    return {
      success: true,
      hash: lockfile.configHash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
