import { normalize, resolve, relative, dirname, sep } from "node:path";

/**
 * Dependency graph: file → Set of files it depends on
 */
export interface DependencyGraph {
  /** Map: normalized file path → Set of normalized dependency paths */
  dependencies: Map<string, Set<string>>;
  /** Map: normalized file path → Set of files that depend on it (reverse) */
  dependents: Map<string, Set<string>>;
  /** All files in the graph */
  files: Set<string>;
}

/**
 * Build options for dependency graph
 */
export interface BuildGraphOptions {
  /** Root directory to resolve relative paths */
  rootDir: string;
  /** tsconfig.json path for TypeScript configuration */
  tsconfigPath?: string;
  /** File glob patterns to include */
  include?: string[];
  /** File glob patterns to exclude */
  exclude?: string[];
}

/**
 * Normalize path to forward slashes and resolve to absolute
 */
function normalizePath(path: string, rootDir: string): string {
  const abs = resolve(rootDir, path);
  return abs.replace(/\\/g, "/");
}

/**
 * Resolve import specifier to file path
 */
function resolveImport(
  sourceFile: import("./ts-morph-types").SourceFile,
  importSpecifier: string,
  rootDir: string,
  project: import("./ts-morph-types").Project
): string | null {
  // Skip external modules (no relative/absolute path)
  if (!importSpecifier.startsWith(".") && !importSpecifier.startsWith("/")) {
    return null;
  }

  const sourceDir = dirname(sourceFile.getFilePath());
  let targetPath = resolve(sourceDir, importSpecifier);

  // Try extensions: .ts, .tsx, .js, .jsx
  const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
  for (const ext of extensions) {
    const candidate = targetPath + ext;
    const sourceFileFound = project.getSourceFile(candidate);
    if (sourceFileFound) {
      return normalizePath(candidate, rootDir);
    }
  }

  // Try index files
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const indexPath = resolve(targetPath, `index${ext}`);
    const sourceFileFound = project.getSourceFile(indexPath);
    if (sourceFileFound) {
      return normalizePath(indexPath, rootDir);
    }
  }

  return null;
}

/**
 * Build dependency graph from TypeScript project
 */
function shouldExcludeFile(filePath: string, excludePatterns: string[]): boolean {
  if (excludePatterns.length === 0) return false;

  const normalizedPath = filePath.replace(/\\/g, "/");
  return excludePatterns.some((pattern) => {
    // **/*.spec.ts → remove **/ and * to get .spec.ts
    let processedPattern = pattern;

    // Remove **/ prefix
    if (processedPattern.startsWith("**/")) {
      processedPattern = processedPattern.substring(3);
    }

    // Remove * prefix
    if (processedPattern.startsWith("*")) {
      processedPattern = processedPattern.substring(1);
    }

    // Now check if file ends with the processed pattern
    return normalizedPath.endsWith(processedPattern);
  });
}

export async function buildDependencyGraph(options: BuildGraphOptions): Promise<DependencyGraph> {
  const { rootDir, tsconfigPath, include, exclude = [] } = options;

  // Lazy load ts-morph only when needed
  const { Project } = await import("ts-morph");

  const project = new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: !tsconfigPath,
  });

  // Add files if no tsconfig
  if (!tsconfigPath && include) {
    project.addSourceFilesAtPaths(include);
  }

  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const files = new Set<string>();

  const sourceFiles = project.getSourceFiles();

  // First pass: collect all files (excluding filtered ones)
  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath(), rootDir);

    // Skip excluded files
    if (shouldExcludeFile(filePath, exclude)) {
      continue;
    }

    files.add(filePath);
    dependencies.set(filePath, new Set());
    dependents.set(filePath, new Set());
  }

  // Second pass: extract imports
  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath(), rootDir);

    // Skip excluded files
    if (shouldExcludeFile(filePath, exclude)) {
      continue;
    }

    const deps = dependencies.get(filePath)!;

    // Process import declarations
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const specifier = importDecl.getModuleSpecifierValue();
      const resolvedPath = resolveImport(sourceFile, specifier, rootDir, project);

      if (resolvedPath && files.has(resolvedPath)) {
        deps.add(resolvedPath);
        dependents.get(resolvedPath)?.add(filePath);
      }
    }

    // Process export declarations with from clause
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      const moduleSpecifier = exportDecl.getModuleSpecifier();
      if (moduleSpecifier) {
        const specifier = moduleSpecifier.getLiteralText();
        const resolvedPath = resolveImport(sourceFile, specifier, rootDir, project);

        if (resolvedPath && files.has(resolvedPath)) {
          deps.add(resolvedPath);
          dependents.get(resolvedPath)?.add(filePath);
        }
      }
    }
  }

  return { dependencies, dependents, files };
}

/**
 * Find all files that transitively depend on the given file
 * Uses DFS to traverse the dependency graph in reverse
 */
export function findDependents(
  graph: DependencyGraph,
  changedFile: string,
  options?: { maxDepth?: number }
): Set<string> {
  const result = new Set<string>();
  const visited = new Set<string>();
  const maxDepth = options?.maxDepth ?? Infinity;

  function dfs(file: string, depth: number) {
    if (visited.has(file)) return; // Prevent infinite loop (circular deps)
    visited.add(file);

    const deps = graph.dependents.get(file);
    if (!deps) return;

    for (const dependent of deps) {
      if (depth < maxDepth) {
        result.add(dependent);
        dfs(dependent, depth + 1);
      }
    }
  }

  dfs(changedFile, 0);
  return result;
}

/**
 * Find all files that the given file transitively depends on
 * Uses DFS to traverse the dependency graph forward
 */
export function findDependencies(
  graph: DependencyGraph,
  file: string,
  options?: { maxDepth?: number }
): Set<string> {
  const result = new Set<string>();
  const visited = new Set<string>();
  const maxDepth = options?.maxDepth ?? Infinity;

  function dfs(currentFile: string, depth: number) {
    if (depth > maxDepth) return;
    if (visited.has(currentFile)) return;
    visited.add(currentFile);

    const deps = graph.dependencies.get(currentFile);
    if (!deps) return;

    for (const dep of deps) {
      result.add(dep);
      dfs(dep, depth + 1);
    }
  }

  dfs(file, 0);
  return result;
}

/**
 * Detect circular dependencies in the graph
 */
export function detectCircularDependencies(graph: DependencyGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(file: string, path: string[]) {
    if (recursionStack.has(file)) {
      // Found a cycle
      const cycleStart = path.indexOf(file);
      const cycle = path.slice(cycleStart);
      cycles.push([...cycle, file]);
      return;
    }

    if (visited.has(file)) return;
    visited.add(file);
    recursionStack.add(file);

    const deps = graph.dependencies.get(file);
    if (deps) {
      for (const dep of deps) {
        dfs(dep, [...path, file]);
      }
    }

    recursionStack.delete(file);
  }

  for (const file of graph.files) {
    if (!visited.has(file)) {
      dfs(file, []);
    }
  }

  return cycles;
}
