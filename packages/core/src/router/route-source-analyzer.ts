import * as ts from "typescript";

import type { HydrationConfig } from "../spec/schema";

const HYDRATION_STRATEGIES = new Set(["none", "island", "full", "progressive"]);
const HYDRATION_PRIORITIES = new Set(["immediate", "visible", "idle", "interaction"]);

export interface RouteSourceAnalysis {
  directives: {
    useClient: boolean;
    useServer: boolean;
  };
  hydrationConfig?: HydrationConfig;
  hydrationSourceRange?: { start: number; end: number };
  imports: RouteSourceImportRecord[];
  exports: RouteSourceExportRecord[];
  defaultExport: RouteSourceDefaultExport;
  diagnostics: RouteSourceDiagnostic[];
}

export interface RouteSourceImportRecord {
  source: string;
  defaultName?: string;
  namespaceName?: string;
  named: Array<{ imported: string; local: string; isTypeOnly?: boolean }>;
  isTypeOnly?: boolean;
  isSideEffectOnly?: boolean;
}

export interface RouteSourceExportRecord {
  name: string;
  kind: "default" | "named";
  localName?: string;
  source?: string;
}

export interface RouteSourceDefaultExport {
  kind: "function" | "identifier" | "call" | "unknown";
  localName?: string;
  source?: string;
  referencesJsx: boolean;
  renderedJsxNames: string[];
}

export interface RouteSourceDiagnostic {
  code:
    | "MANDU_ROUTE_HYDRATION_UNSUPPORTED_INITIALIZER"
    | "MANDU_ROUTE_HYDRATION_INVALID_VALUE"
    | "MANDU_ROUTE_DEFAULT_EXPORT_WRAPPER";
  severity: "warning";
  message: string;
  start?: number;
  end?: number;
}

interface AnalyzerContext {
  sourceFile: ts.SourceFile;
  declarations: Map<string, ts.Node>;
  variableInitializers: Map<string, ts.Expression>;
  diagnostics: RouteSourceDiagnostic[];
}

export function analyzeRouteSource(source: string, fileName = "route.tsx"): RouteSourceAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics: RouteSourceDiagnostic[] = [];
  const declarations = new Map<string, ts.Node>();
  const variableInitializers = new Map<string, ts.Expression>();
  const context: AnalyzerContext = { sourceFile, declarations, variableInitializers, diagnostics };

  const imports: RouteSourceImportRecord[] = [];
  const exports: RouteSourceExportRecord[] = [];
  let hydrationConfig: HydrationConfig | undefined;
  let hydrationSourceRange: { start: number; end: number } | undefined;
  let defaultExport: RouteSourceDefaultExport = {
    kind: "unknown",
    referencesJsx: false,
    renderedJsxNames: [],
  };

  for (const statement of sourceFile.statements) {
    collectDeclaration(statement, context);

    if (ts.isImportDeclaration(statement)) {
      const record = getImportRecord(statement);
      if (record) imports.push(record);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const hydration = readHydrationExport(statement, context);
      if (hydration) {
        hydrationConfig = hydration.config;
        hydrationSourceRange = hydration.sourceRange;
      }
      exports.push(...getVariableExports(statement));
      continue;
    }

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      exports.push(...getDeclarationExports(statement));
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        defaultExport = createDefaultExportFromNode("function", statement, context, statement.name?.text);
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      defaultExport = createDefaultExportFromExpression(statement.expression, context);
      exports.push({ name: "default", kind: "default", localName: defaultExport.localName });
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const records = getExportDeclarationRecords(statement);
      exports.push(...records);
      const defaultRecord = records.find((record) => record.name === "default");
      if (defaultRecord) {
        defaultExport = {
          kind: "identifier",
          localName: defaultRecord.localName,
          source: defaultRecord.source,
          referencesJsx: false,
          renderedJsxNames: [],
        };
      }
    }
  }

  return {
    directives: getDirectives(sourceFile),
    hydrationConfig,
    hydrationSourceRange,
    imports,
    exports,
    defaultExport,
    diagnostics,
  };
}

function getDirectives(sourceFile: ts.SourceFile): RouteSourceAnalysis["directives"] {
  let useClient = false;
  let useServer = false;

  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use client") useClient = true;
    if (statement.expression.text === "use server") useServer = true;
  }

  return { useClient, useServer };
}

function collectDeclaration(statement: ts.Statement, context: AnalyzerContext): void {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
    context.declarations.set(statement.name.text, statement);
    return;
  }

  if (!ts.isVariableStatement(statement)) return;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    context.declarations.set(declaration.name.text, declaration);
    if (declaration.initializer) {
      context.variableInitializers.set(declaration.name.text, declaration.initializer);
    }
  }
}

function getImportRecord(statement: ts.ImportDeclaration): RouteSourceImportRecord | null {
  const source = getStringModuleSpecifier(statement.moduleSpecifier);
  if (!source) return null;
  const importClause = statement.importClause;
  if (!importClause) {
    return { source, named: [], isSideEffectOnly: true };
  }

  const record: RouteSourceImportRecord = {
    source,
    named: [],
    isTypeOnly: importClause.isTypeOnly || undefined,
  };

  if (importClause.name && !importClause.isTypeOnly) {
    record.defaultName = importClause.name.text;
  }

  const namedBindings = importClause.namedBindings;
  if (namedBindings && ts.isNamespaceImport(namedBindings) && !importClause.isTypeOnly) {
    record.namespaceName = namedBindings.name.text;
  }

  if (namedBindings && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) {
      record.named.push({
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
        isTypeOnly: importClause.isTypeOnly || element.isTypeOnly || undefined,
      });
    }
  }

  return record;
}

function readHydrationExport(
  statement: ts.VariableStatement,
  context: AnalyzerContext,
): { config?: HydrationConfig; sourceRange: { start: number; end: number } } | null {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return null;

  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "hydration") continue;
    const sourceRange = {
      start: declaration.getStart(context.sourceFile),
      end: declaration.getEnd(),
    };
    if (!declaration.initializer) {
      pushDiagnostic(
        context,
        "MANDU_ROUTE_HYDRATION_UNSUPPORTED_INITIALIZER",
        "Route hydration export must have an initializer.",
        declaration,
      );
      return { sourceRange };
    }
    return {
      config: readHydrationInitializer(declaration.initializer, context),
      sourceRange,
    };
  }

  return null;
}

function readHydrationInitializer(
  initializer: ts.Expression,
  context: AnalyzerContext,
): HydrationConfig | undefined {
  if (ts.isStringLiteral(initializer)) {
    const strategy = initializer.text;
    if (!HYDRATION_STRATEGIES.has(strategy)) {
      pushHydrationValueDiagnostic(context, initializer, "strategy", strategy);
      return undefined;
    }
    return {
      strategy: strategy as HydrationConfig["strategy"],
      priority: "visible",
      preload: false,
    };
  }

  if (!ts.isObjectLiteralExpression(initializer)) {
    pushDiagnostic(
      context,
      "MANDU_ROUTE_HYDRATION_UNSUPPORTED_INITIALIZER",
      "Route hydration export must be an object literal or a supported strategy string literal.",
      initializer,
    );
    return undefined;
  }

  const strategy = readStringProperty(initializer, "strategy");
  if (!strategy || !HYDRATION_STRATEGIES.has(strategy.value)) {
    pushHydrationValueDiagnostic(context, strategy?.node ?? initializer, "strategy", strategy?.value);
    return undefined;
  }

  const priority = readStringProperty(initializer, "priority");
  if (priority && !HYDRATION_PRIORITIES.has(priority.value)) {
    pushHydrationValueDiagnostic(context, priority.node, "priority", priority.value);
  }

  return {
    strategy: strategy.value as HydrationConfig["strategy"],
    priority: HYDRATION_PRIORITIES.has(priority?.value ?? "")
      ? (priority?.value as HydrationConfig["priority"])
      : "visible",
    preload: readBooleanProperty(initializer, "preload") ?? false,
  };
}

function readStringProperty(
  object: ts.ObjectLiteralExpression,
  key: string,
): { value: string; node: ts.Node } | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (getPropertyNameText(property.name) !== key) continue;
    if (!ts.isStringLiteral(property.initializer)) return null;
    return { value: property.initializer.text, node: property.initializer };
  }
  return null;
}

function readBooleanProperty(object: ts.ObjectLiteralExpression, key: string): boolean | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (getPropertyNameText(property.name) !== key) continue;
    if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
    return undefined;
  }
  return undefined;
}

function getVariableExports(statement: ts.VariableStatement): RouteSourceExportRecord[] {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
  return statement.declarationList.declarations
    .filter((declaration): declaration is ts.VariableDeclaration & { name: ts.Identifier } => ts.isIdentifier(declaration.name))
    .map((declaration) => ({
      name: declaration.name.text,
      kind: "named" as const,
      localName: declaration.name.text,
    }));
}

function getDeclarationExports(statement: ts.FunctionDeclaration | ts.ClassDeclaration): RouteSourceExportRecord[] {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
  const localName = statement.name?.text;
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
    return [{ name: "default", kind: "default", localName }];
  }
  return localName ? [{ name: localName, kind: "named", localName }] : [];
}

function getExportDeclarationRecords(statement: ts.ExportDeclaration): RouteSourceExportRecord[] {
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return [];
  const source = getStringModuleSpecifier(statement.moduleSpecifier);
  return statement.exportClause.elements.map((element) => {
    const exportedName = element.name.text;
    const localName = element.propertyName?.text ?? element.name.text;
    return {
      name: exportedName,
      kind: exportedName === "default" ? "default" as const : "named" as const,
      localName,
      source: source ?? undefined,
    };
  });
}

function createDefaultExportFromExpression(
  expression: ts.Expression,
  context: AnalyzerContext,
): RouteSourceDefaultExport {
  if (ts.isIdentifier(expression)) {
    return createDefaultExportFromIdentifier(expression.text, context);
  }

  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
    return createDefaultExportFromNode("function", expression, context);
  }

  if (ts.isCallExpression(expression)) {
    pushDiagnostic(
      context,
      "MANDU_ROUTE_DEFAULT_EXPORT_WRAPPER",
      "Route default export is a call expression. Mandu treats this as a conservative wrapper and does not infer route-level client entries from it.",
      expression,
    );
    return {
      kind: "call",
      localName: getExpressionName(expression.expression, context.sourceFile),
      referencesJsx: hasJsxReference(expression),
      renderedJsxNames: collectJsxElementNames(expression),
    };
  }

  return {
    kind: "unknown",
    referencesJsx: hasJsxReference(expression),
    renderedJsxNames: collectJsxElementNames(expression),
  };
}

function createDefaultExportFromIdentifier(
  localName: string,
  context: AnalyzerContext,
  seen = new Set<string>(),
): RouteSourceDefaultExport {
  if (seen.has(localName)) {
    return { kind: "identifier", localName, referencesJsx: false, renderedJsxNames: [] };
  }
  seen.add(localName);

  const initializer = context.variableInitializers.get(localName);
  if (initializer) {
    if (ts.isIdentifier(initializer)) {
      return createDefaultExportFromIdentifier(initializer.text, context, seen);
    }
    return {
      kind: "identifier",
      localName,
      referencesJsx: hasJsxReference(initializer),
      renderedJsxNames: collectJsxElementNames(initializer),
    };
  }

  const declaration = context.declarations.get(localName);
  if (declaration) {
    return {
      kind: "identifier",
      localName,
      referencesJsx: hasJsxReference(declaration),
      renderedJsxNames: collectJsxElementNames(declaration),
    };
  }

  return { kind: "identifier", localName, referencesJsx: false, renderedJsxNames: [] };
}

function createDefaultExportFromNode(
  kind: RouteSourceDefaultExport["kind"],
  node: ts.Node,
  context: AnalyzerContext,
  localName?: string,
): RouteSourceDefaultExport {
  return {
    kind,
    localName,
    referencesJsx: hasJsxReference(node),
    renderedJsxNames: collectJsxElementNames(node),
  };
}

function hasJsxReference(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (
      ts.isJsxElement(candidate) ||
      ts.isJsxSelfClosingElement(candidate) ||
      ts.isJsxFragment(candidate)
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function collectJsxElementNames(node: ts.Node): string[] {
  const names = new Set<string>();
  const visit = (candidate: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(candidate)) {
      addJsxTagNames(candidate.tagName, names);
    } else if (ts.isJsxElement(candidate)) {
      addJsxTagNames(candidate.openingElement.tagName, names);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return Array.from(names);
}

function addJsxTagNames(tagName: ts.JsxTagNameExpression, names: Set<string>): void {
  const text = tagName.getText();
  if (!text || text[0] === text[0]?.toLowerCase()) return;
  names.add(text);
}

function pushHydrationValueDiagnostic(
  context: AnalyzerContext,
  node: ts.Node,
  key: string,
  value: string | undefined,
): void {
  pushDiagnostic(
    context,
    "MANDU_ROUTE_HYDRATION_INVALID_VALUE",
    `Route hydration.${key} has unsupported value ${JSON.stringify(value)}.`,
    node,
  );
}

function pushDiagnostic(
  context: AnalyzerContext,
  code: RouteSourceDiagnostic["code"],
  message: string,
  node: ts.Node,
): void {
  context.diagnostics.push({
    code,
    severity: "warning",
    message,
    start: node.getStart(context.sourceFile),
    end: node.getEnd(),
  });
}

function hasModifier(
  node: ts.Node,
  kind: ts.SyntaxKind.ExportKeyword | ts.SyntaxKind.DefaultKeyword,
): boolean {
  return !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind);
}

function getStringModuleSpecifier(moduleSpecifier: ts.Expression | undefined): string | null {
  return moduleSpecifier && ts.isStringLiteral(moduleSpecifier)
    ? moduleSpecifier.text
    : null;
}

function getPropertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function getExpressionName(expression: ts.Expression, sourceFile: ts.SourceFile): string | undefined {
  return ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)
    ? expression.getText(sourceFile)
    : undefined;
}
