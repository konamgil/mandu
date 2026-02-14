import { Project, SyntaxKind, type Node } from "ts-morph";
import fg from "fast-glob";
import { relative, join } from "node:path";
import { createEmptyGraph, addEdge, addNode } from "./ir";
import { getAtePaths, writeJson } from "./fs";
import type { ExtractInput, InteractionGraph } from "./types";

const DEFAULT_ROUTE_GLOBS = ["app/**/page.tsx", "routes/**/page.tsx"]; // demo-first default

function isStringLiteral(node: Node): node is import("ts-morph").StringLiteral {
  return node.getKind() === SyntaxKind.StringLiteral;
}

function tryExtractLiteralArg(callExpr: import("ts-morph").CallExpression, argIndex = 0): string | null {
  const args = callExpr.getArguments();
  const arg = args[argIndex];
  if (!arg) return null;
  if (isStringLiteral(arg)) return arg.getLiteralValue();
  return null;
}

export async function extract(input: ExtractInput): Promise<{ ok: true; graphPath: string; summary: { nodes: number; edges: number } }> {
  const repoRoot = input.repoRoot;
  const buildSalt = input.buildSalt ?? process.env.MANDU_BUILD_SALT ?? "dev";
  const paths = getAtePaths(repoRoot);

  const graph: InteractionGraph = createEmptyGraph(buildSalt);

  const routeGlobs = input.routeGlobs?.length ? input.routeGlobs : DEFAULT_ROUTE_GLOBS;
  const routeFiles = await fg(routeGlobs, {
    cwd: repoRoot,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/.mandu/**"],
  });

  const project = new Project({
    tsConfigFilePath: input.tsconfigPath ? join(repoRoot, input.tsconfigPath) : undefined,
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of routeFiles) {
    const sourceFile = project.addSourceFileAtPath(filePath);
    const rel = relative(repoRoot, filePath);
    const relNormalized = rel.replace(/\\/g, "/");

    // route node id: normalize to path without trailing /page.tsx
    const routePath = relNormalized
      .replace(/^app\//, "/")
      .replace(/^routes\//, "/")
      .replace(/\/page\.tsx$/, "")
      .replace(/\/index\.tsx$/, "")
      .replace(/\/page$/, "")
      .replace(/\\/g, "/");

    addNode(graph, { kind: "route", id: routePath === "" ? "/" : routePath, file: relNormalized, path: routePath === "" ? "/" : routePath });

    // ManduLink / Link literal extraction: <Link href="/x"> or <ManduLink to="/x">
    const jsxAttrs = sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute);
    for (const attr of jsxAttrs) {
      const name = (attr as any).getNameNode?.().getText?.() ?? (attr as any).getName?.() ?? "";
      if (name !== "to" && name !== "href") continue;
      const init = (attr as any).getInitializer?.();
      if (!init) continue;
      if (init.getKind?.() === SyntaxKind.StringLiteral) {
        const raw = (init as any).getLiteralValue?.() ?? init.getText?.();
        const to = typeof raw === "string" ? raw.replace(/^"|"$/g, "") : null;
        if (typeof to === "string" && to.startsWith("/")) {
          addEdge(graph, { kind: "navigate", from: routePath || "/", to, file: relNormalized, source: `<jsx ${name}>` });
        }
      }
    }

    // mandu.navigate("/x") literal
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const exprText = call.getExpression().getText();
      if (exprText === "mandu.navigate" || exprText.endsWith(".navigate")) {
        const to = tryExtractLiteralArg(call, 0);
        if (to && to.startsWith("/")) {
          addEdge(graph, { kind: "navigate", from: routePath || "/", to, file: relNormalized, source: "mandu.navigate" });
        }
      }
      if (exprText === "mandu.modal.open" || exprText.endsWith(".modal.open")) {
        const modal = tryExtractLiteralArg(call, 0);
        if (modal) {
          addEdge(graph, { kind: "openModal", from: routePath || "/", modal, file: relNormalized, source: "mandu.modal.open" });
        }
      }
      if (exprText === "mandu.action.run" || exprText.endsWith(".action.run")) {
        const action = tryExtractLiteralArg(call, 0);
        if (action) {
          addEdge(graph, { kind: "runAction", from: routePath || "/", action, file: relNormalized, source: "mandu.action.run" });
        }
      }
    }
  }

  writeJson(paths.interactionGraphPath, graph);

  return {
    ok: true,
    graphPath: paths.interactionGraphPath,
    summary: { nodes: graph.nodes.length, edges: graph.edges.length },
  };
}
