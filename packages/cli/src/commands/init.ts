import path from "path";
import fs from "fs/promises";

export interface InitOptions {
  name?: string;
  template?: string;
}

async function copyDir(src: string, dest: string, projectName: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, projectName);
    } else {
      let content = await fs.readFile(srcPath, "utf-8");
      // Replace template variables
      content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
      await fs.writeFile(destPath, content);
    }
  }
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

  console.log(`🥟 Mandu Init`);
  console.log(`📁 프로젝트: ${projectName}`);
  console.log(`📦 템플릿: ${template}\n`);

  // Check if target directory exists
  try {
    await fs.access(targetDir);
    console.error(`❌ 디렉토리가 이미 존재합니다: ${targetDir}`);
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
    console.error(`❌ 템플릿을 찾을 수 없습니다: ${template}`);
    console.error(`   사용 가능한 템플릿: default`);
    return false;
  }

  console.log(`📋 템플릿 복사 중...`);

  try {
    await copyDir(templateDir, targetDir, projectName);
  } catch (error) {
    console.error(`❌ 템플릿 복사 실패:`, error);
    return false;
  }

  // Create .mandu directory for build output
  await fs.mkdir(path.join(targetDir, ".mandu/client"), { recursive: true });

  console.log(`\n✅ 프로젝트 생성 완료!\n`);
  console.log(`📍 위치: ${targetDir}`);
  console.log(`\n🚀 시작하기:`);
  console.log(`   cd ${projectName}`);
  console.log(`   bun install`);
  console.log(`   bun run dev`);
  console.log(`\n📂 파일 구조:`);
  console.log(`   app/page.tsx      → http://localhost:3000/`);
  console.log(`   app/api/*/route.ts → API endpoints`);

  return true;
}
