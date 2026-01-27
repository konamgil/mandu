import { loadManifest, startServer, registerApiHandler, registerPageLoader } from "@mandujs/core";
import path from "path";

const SPEC_PATH = path.resolve(import.meta.dir, "../../spec/routes.manifest.json");

async function main() {
  console.log("🥟 Mandu Server Starting...\n");

  const result = await loadManifest(SPEC_PATH);

  if (!result.success || !result.data) {
    console.error("❌ Spec 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`✅ Spec 로드 완료: ${result.data.routes.length}개 라우트`);

  for (const route of result.data.routes) {
    if (route.kind === "api") {
      const modulePath = path.resolve(import.meta.dir, "../../", route.module);
      try {
        const module = await import(modulePath);
        registerApiHandler(route.id, module.default || module.handler);
        console.log(`  📡 API: ${route.pattern} -> ${route.id}`);
      } catch (error) {
        console.error(`  ❌ API 핸들러 로드 실패: ${route.id}`, error);
      }
    } else if (route.kind === "page") {
      const componentPath = path.resolve(import.meta.dir, "../../", route.componentModule!);
      registerPageLoader(route.id, () => import(componentPath));
      console.log(`  📄 Page: ${route.pattern} -> ${route.id}`);
    }
  }

  console.log("");

  const server = startServer(result.data, {
    port: Number(process.env.PORT) || 3000,
  });

  process.on("SIGINT", () => {
    console.log("\n🛑 서버 종료 중...");
    server.stop();
    process.exit(0);
  });
}

main().catch(console.error);
