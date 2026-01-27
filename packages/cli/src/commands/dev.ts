import { loadManifest, startServer, registerApiHandler, registerPageLoader } from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";
import path from "path";

export interface DevOptions {
  port?: number;
}

export async function dev(options: DevOptions = {}): Promise<void> {
  const specPath = resolveFromCwd("spec/routes.manifest.json");
  const rootDir = resolveFromCwd(".");

  console.log(`🥟 Mandu Dev Server`);
  console.log(`📄 Spec 파일: ${specPath}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`✅ Spec 로드 완료: ${result.data.routes.length}개 라우트`);

  for (const route of result.data.routes) {
    if (route.kind === "api") {
      const modulePath = path.resolve(rootDir, route.module);
      try {
        const module = await import(modulePath);
        registerApiHandler(route.id, module.default || module.handler);
        console.log(`  📡 API: ${route.pattern} -> ${route.id}`);
      } catch (error) {
        console.error(`  ❌ API 핸들러 로드 실패: ${route.id}`, error);
      }
    } else if (route.kind === "page" && route.componentModule) {
      const componentPath = path.resolve(rootDir, route.componentModule);
      registerPageLoader(route.id, () => import(componentPath));
      console.log(`  📄 Page: ${route.pattern} -> ${route.id}`);
    }
  }

  console.log("");

  const port = options.port || Number(process.env.PORT) || 3000;

  const server = startServer(result.data, { port });

  process.on("SIGINT", () => {
    console.log("\n🛑 서버 종료 중...");
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 서버 종료 중...");
    server.stop();
    process.exit(0);
  });
}
