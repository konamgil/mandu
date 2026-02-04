import path from "path";
import fs from "fs/promises";
import { CLI_ERROR_CODES, printCLIError } from "../errors";

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

export async function init(options: InitOptions = {}): Promise<boolean> {
  const projectName = options.name || "my-mandu-app";
  const template = options.template || "default";
  const targetDir = path.resolve(process.cwd(), projectName);

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
    console.error(`   사용 가능한 템플릿: default`);
    return false;
  }

  console.log(`📋 템플릿 복사 중...`);

  const copyOptions: CopyOptions = {
    projectName,
    css,
    ui,
    theme,
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

  console.log(`\n✅ 프로젝트 생성 완료!\n`);
  console.log(`📍 위치: ${targetDir}`);
  console.log(`\n🚀 시작하기:`);
  console.log(`   cd ${projectName}`);
  console.log(`   bun install`);
  console.log(`   bun run dev`);
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
  if (mcpResult.status === "created") {
    console.log(`   .mcp.json 생성됨 (Claude Code 자동 연결)`);
  } else if (mcpResult.status === "updated") {
    console.log(`   .mcp.json에 mandu 서버 추가/업데이트됨`);
  } else if (mcpResult.status === "unchanged") {
    console.log(`   .mcp.json 이미 최신`);
  } else if (mcpResult.status === "backed-up") {
    console.log(`   .mcp.json 파싱 실패 → 백업 후 새로 생성됨`);
    if (mcpResult.backupPath) {
      console.log(`   백업: ${mcpResult.backupPath}`);
    }
  } else if (mcpResult.status === "error") {
    console.log(`   .mcp.json 설정 실패: ${mcpResult.error}`);
  }
  console.log(`   AGENTS.md → 에이전트 가이드 (Bun 사용 명시)`);

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

interface McpConfigResult {
  status: McpConfigStatus;
  backupPath?: string;
  error?: string;
}

/**
 * .mcp.json 설정 (AI 에이전트 통합)
 * - 파일 없으면 새로 생성
 * - 파일 있으면 mandu 서버만 추가/업데이트 (다른 설정 유지)
 */
async function setupMcpConfig(targetDir: string): Promise<McpConfigResult> {
  const mcpPath = path.join(targetDir, ".mcp.json");

  const manduServer = {
    command: "bunx",
    args: ["@mandujs/mcp"],
  };

  const writeConfig = async (data: Record<string, unknown>) => {
    await fs.writeFile(mcpPath, JSON.stringify(data, null, 2) + "\n");
  };

  const fileExists = async (filePath: string) => {
    try {
      await fs.access(filePath);
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
    const existingContent = await fs.readFile(mcpPath, "utf-8");
    let existing: Record<string, unknown>;

    try {
      existing = JSON.parse(existingContent) as Record<string, unknown>;
    } catch {
      const backupPath = await getBackupPath(mcpPath);
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
}
