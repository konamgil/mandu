import path from "path";
import fs from "fs/promises";

export interface GenerateScaffoldOptions {
  kind: "page" | "api" | "feature";
  name?: unknown;
  methods?: unknown;
  force?: boolean;
}

export async function generateScaffold(options: GenerateScaffoldOptions): Promise<boolean> {
  const routeName = normalizeName(options.name);
  if (!routeName) {
    console.error(`Usage: mandu generate ${options.kind} <path>`);
    return false;
  }

  const cwd = process.cwd();
  const files =
    options.kind === "page"
      ? [pageFile(routeName)]
      : options.kind === "api"
        ? [apiFile(routeName, parseMethods(options.methods))]
        : [
            pageFile(routeName),
            apiFile(routeName, parseMethods(options.methods)),
          ];

  for (const file of files) {
    const abs = path.join(cwd, file.relativePath);
    if (!options.force && await exists(abs)) {
      console.error(`File already exists: ${file.relativePath}`);
      console.error("Re-run with --force to overwrite.");
      return false;
    }
  }

  for (const file of files) {
    const abs = path.join(cwd, file.relativePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.content);
    console.log(`Created ${file.relativePath}`);
  }

  return true;
}

interface GeneratedFile {
  relativePath: string;
  content: string;
}

function pageFile(input: string): GeneratedFile {
  const routePath = normalizePageRoute(input);
  const title = routePath === "/" ? "Home" : titleFromRoute(routePath);
  const segments = routePath === "/" ? [] : routePath.slice(1).split("/");
  return {
    relativePath: path.join("app", ...segments, "page.tsx"),
    content: `export default function Page() {
  return (
    <main>
      <h1>${title}</h1>
    </main>
  );
}
`,
  };
}

function apiFile(input: string, methods: string[]): GeneratedFile {
  const routePath = normalizeApiRoute(input);
  const segments = routePath.slice("/api/".length).split("/").filter(Boolean);
  const handlers = methods.map((method) => handlerForMethod(method, routePath)).join("\n");
  return {
    relativePath: path.join("app", "api", ...segments, "route.ts"),
    content: `import { Mandu } from "@mandujs/core";

export default Mandu.filling()
${handlers};
`,
  };
}

function handlerForMethod(method: string, routePath: string): string {
  const lower = method.toLowerCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    return `  .${lower}(async (ctx) => {
    const body = await ctx.body().catch(() => null);
    return ctx.${method === "POST" ? "created" : "ok"}({ ok: true, route: "${routePath}", body });
  })`;
  }
  if (method === "DELETE") {
    return `  .delete((ctx) => ctx.ok({ ok: true, route: "${routePath}", params: ctx.params }))`;
  }
  return `  .${lower}((ctx) => ctx.ok({ ok: true, route: "${routePath}", params: ctx.params }))`;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizePageRoute(input: string): string {
  let route = input.trim().replace(/\\/g, "/");
  route = route.replace(/^app\//, "").replace(/\/?page\.[jt]sx?$/, "");
  if (!route || route === ".") return "/";
  if (!route.startsWith("/")) route = `/${route}`;
  return route.replace(/\/+$/, "") || "/";
}

function normalizeApiRoute(input: string): string {
  let route = input.trim().replace(/\\/g, "/");
  route = route.replace(/^app\/api\//, "").replace(/^api\//, "").replace(/\/?route\.[jt]s$/, "");
  if (route.startsWith("/api/")) return route.replace(/\/+$/, "");
  route = route.replace(/^\/+/, "");
  return `/api/${route}`.replace(/\/+$/, "");
}

function parseMethods(value: unknown): string[] {
  const raw = typeof value === "string" && value.trim() ? value : "GET";
  const supported = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  const methods = raw
    .split(",")
    .map((method) => method.trim().toUpperCase())
    .filter((method) => supported.has(method));
  return methods.length > 0 ? [...new Set(methods)] : ["GET"];
}

function titleFromRoute(routePath: string): string {
  const last = routePath.split("/").filter(Boolean).at(-1) ?? "Page";
  return last
    .replace(/\[|\]/g, "")
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
