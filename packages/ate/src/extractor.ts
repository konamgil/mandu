import fg from "fast-glob";
import { relative, join } from "node:path";
import { createEmptyGraph, addEdge, addNode } from "./ir";
import { getAtePaths, writeJson } from "./fs";
import type { ExtractInput, InteractionGraph } from "./types";
import type { Node, CallExpression, JsxAttribute, SyntaxKindEnum } from "./ts-morph-types";

const DEFAULT_ROUTE_GLOBS = [
  "app/**/page.tsx",
  "app/**/route.ts",
  "routes/**/page.tsx",
  "routes/**/route.ts",
];

function isStringLiteral(node: Node, SK: SyntaxKindEnum): boolean {
  return node.getKind() === SK.StringLiteral;
}

function tryExtractLiteralArg(callExpr: CallExpression, argIndex = 0, SK: SyntaxKindEnum): string | null {
  const args = callExpr.getArguments();
  const arg = args[argIndex];
  if (!arg) return null;
  if (isStringLiteral(arg, SK)) return (arg as Node & { getLiteralValue(): string }).getLiteralValue();
  return null;
}

export async function extract(input: ExtractInput): Promise<{ ok: true; graphPath: string; summary: { nodes: number; edges: number }; warnings: string[] }> {
  const repoRoot = input.repoRoot;
  const buildSalt = input.buildSalt ?? process.env.MANDU_BUILD_SALT ?? "dev";
  const paths = getAtePaths(repoRoot);
  const warnings: string[] = [];

  const graph: InteractionGraph = createEmptyGraph(buildSalt);

  // Validate input
  if (!repoRoot) {
    throw new Error("repoRoot는 필수입니다");
  }

  const routeGlobs = input.routeGlobs?.length ? input.routeGlobs : DEFAULT_ROUTE_GLOBS;

  let routeFiles: string[];
  try {
    routeFiles = await fg(routeGlobs, {
      cwd: repoRoot,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.mandu/**"],
    });
  } catch (err: unknown) {
    throw new Error(`파일 검색 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (routeFiles.length === 0) {
    warnings.push(`경고: route 파일을 찾을 수 없습니다 (globs: ${routeGlobs.join(", ")})`);
  }

  // Lazy load ts-morph only when needed
  const { Project, SyntaxKind } = await import("ts-morph");
  const SK = SyntaxKind as unknown as SyntaxKindEnum;

  let project: InstanceType<typeof Project>;
  try {
    project = new Project({
      tsConfigFilePath: input.tsconfigPath ? join(repoRoot, input.tsconfigPath) : undefined,
      skipAddingFilesFromTsConfig: true,
    });
  } catch (err: unknown) {
    throw new Error(`TypeScript 프로젝트 초기화 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const filePath of routeFiles) {
    try {
      const sourceFile = project.addSourceFileAtPath(filePath);
      const rel = relative(repoRoot, filePath);
      const relNormalized = rel.replace(/\\/g, "/");

      const isApiRoute = relNormalized.endsWith("/route.ts");

      // route node id: normalize to path without trailing /page.tsx or /route.ts
      const routePath = relNormalized
        .replace(/^app\//, "/")
        .replace(/^routes\//, "/")
        .replace(/\/page\.tsx$/, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\/index\.tsx$/, "")
        .replace(/\/page$/, "")
        .replace(/\\/g, "/");

      // API route: extract HTTP methods from exports (GET, POST, PUT, PATCH, DELETE)
      let methods: string[] = [];
      if (isApiRoute) {
        const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
        const exportDecls = sourceFile.getExportedDeclarations();
        for (const [name] of exportDecls) {
          if (HTTP_METHODS.includes(name)) {
            methods.push(name);
          }
        }
        if (methods.length === 0) methods = ["GET"]; // default
      }

      addNode(graph, {
        kind: "route",
        id: routePath === "" ? "/" : routePath,
        file: relNormalized,
        path: routePath === "" ? "/" : routePath,
        ...(isApiRoute ? { methods } : {}),
      });

      // API route에는 JSX/navigation이 없으므로 건너뜀
      if (isApiRoute) continue;

      // ManduLink / Link literal extraction: <Link href="/x"> or <ManduLink to="/x">
      try {
        const jsxAttrs = sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute) as unknown as JsxAttribute[];
        for (const attr of jsxAttrs) {
          try {
            const name = attr.getNameNode?.().getText?.() ?? attr.getName?.() ?? "";
            if (name !== "to" && name !== "href") continue;
            const init = attr.getInitializer?.();
            if (!init) continue;
            if (init.getKind?.() === SK.StringLiteral) {
              const raw = init.getLiteralValue?.() ?? init.getText?.();
              const to = typeof raw === "string" ? raw.replace(/^"|"$/g, "") : null;
              if (typeof to === "string" && to.startsWith("/")) {
                addEdge(graph, { kind: "navigate", from: routePath || "/", to, file: relNormalized, source: `<jsx ${name}>` });
              }
            }
          } catch (err: unknown) {
            // Skip invalid JSX attributes
            warnings.push(`JSX 속성 파싱 실패 (${relNormalized}): ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err: unknown) {
        warnings.push(`JSX 분석 실패 (${relNormalized}): ${err instanceof Error ? err.message : String(err)}`);
      }

      // mandu.navigate("/x") literal
      try {
        const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as unknown as CallExpression[];
        for (const call of calls) {
          try {
            const exprText = call.getExpression().getText();
            if (exprText === "mandu.navigate" || exprText.endsWith(".navigate")) {
              const to = tryExtractLiteralArg(call, 0, SK);
              if (to && to.startsWith("/")) {
                addEdge(graph, { kind: "navigate", from: routePath || "/", to, file: relNormalized, source: "mandu.navigate" });
              }
            }
            if (exprText === "mandu.modal.open" || exprText.endsWith(".modal.open")) {
              const modal = tryExtractLiteralArg(call, 0, SK);
              if (modal) {
                addEdge(graph, { kind: "openModal", from: routePath || "/", modal, file: relNormalized, source: "mandu.modal.open" });
              }
            }
            if (exprText === "mandu.action.run" || exprText.endsWith(".action.run")) {
              const action = tryExtractLiteralArg(call, 0, SK);
              if (action) {
                addEdge(graph, { kind: "runAction", from: routePath || "/", action, file: relNormalized, source: "mandu.action.run" });
              }
            }
          } catch (err: unknown) {
            // Skip invalid call expressions
            warnings.push(`함수 호출 파싱 실패 (${relNormalized}): ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err: unknown) {
        warnings.push(`함수 호출 분석 실패 (${relNormalized}): ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err: unknown) {
      // Graceful degradation: skip this file and continue
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`파일 파싱 실패 (${filePath}): ${msg}`);
      console.warn(`[ATE] 파일 스킵: ${filePath} - ${msg}`);
      continue;
    }
  }

  try {
    writeJson(paths.interactionGraphPath, graph);
  } catch (err: unknown) {
    throw new Error(`Interaction graph 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: true,
    graphPath: paths.interactionGraphPath,
    summary: { nodes: graph.nodes.length, edges: graph.edges.length },
    warnings,
  };
}
