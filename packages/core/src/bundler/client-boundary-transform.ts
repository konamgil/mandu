import * as ts from "typescript";

import type { HydrationPriority } from "../spec/schema";

const DEFAULT_BOUNDARY_IMPORT = "@mandujs/core/internal/client-boundary";
const BOUNDARY_COMPONENT = "__ManduClientBoundary";
const CLIENT_MODULE_PATTERN = /\.(?:client|island)(?:\.[cm]?[jt]sx?)?$/;

export type ClientBoundaryHydrateMode = HydrationPriority | "load" | "manual" | `media(${string})`;

export interface ClientBoundaryTransformOptions {
  routeId: string;
  fileName?: string;
  hydrate?: ClientBoundaryHydrateMode;
  boundaryImport?: string;
  ordinalOffset?: number;
  boundaryReplay?: readonly ClientBoundaryReplayRecord[];
}

export interface ClientBoundaryReplayRecord {
  id?: string;
  ordinal: number;
}

export interface ClientBoundaryRecord {
  id: string;
  routeId: string;
  module: string;
  importSpecifier: string;
  exportName: string;
  localName: string;
  hydrate: ClientBoundaryHydrateMode;
  ordinal: number;
  propsSource: "inline";
  propsKeys: string[];
  hasSpreadProps: boolean;
  source: {
    file: string;
    line: number;
    column: number;
  };
}

export interface ClientBoundaryDiagnostic {
  code:
    | "MANDU_BOUNDARY_UNSUPPORTED_CHILDREN"
    | "MANDU_BOUNDARY_UNSUPPORTED_FUNCTION_PROP"
    | "MANDU_BOUNDARY_UNSUPPORTED_PROP_VALUE"
    | "MANDU_BOUNDARY_UNSUPPORTED_REF"
    | "MANDU_BOUNDARY_INVALID_HOST_CONTEXT"
    | "MANDU_BOUNDARY_SERVER_ONLY_IMPORT"
    | "MANDU_BOUNDARY_UNRESOLVED_EXPORT";
  severity: "error";
  message: string;
  suggestion: string;
  routeId: string;
  boundaryId?: string;
  module?: string;
  exportName?: string;
  source: {
    file: string;
    line: number;
    column: number;
  };
}

export interface ClientBoundaryTransformResult {
  code: string;
  transformed: boolean;
  boundaries: ClientBoundaryRecord[];
  diagnostics: ClientBoundaryDiagnostic[];
}

export type ClientBoundaryExportValidationStatus = "found" | "missing" | "unknown";

const SERVER_ONLY_MODULE_SPECIFIERS = new Set([
  "async_hooks",
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

const INVALID_BOUNDARY_HOST_CONTEXTS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "colgroup",
  "select",
  "optgroup",
  "option",
  "ul",
  "ol",
  "dl",
  "p",
]);

interface ClientImportBinding {
  module: string;
  exportName: string;
  localName: string;
}

interface NamespaceImportBinding {
  module: string;
  namespace: string;
}

interface CollectedClientImports {
  importsByLocalName: Map<string, ClientImportBinding>;
  namespaceImports: Map<string, NamespaceImportBinding>;
  removableImports: Set<ts.ImportDeclaration>;
  hasBoundaryImport: boolean;
}

export function transformClientBoundaries(
  source: string,
  options: ClientBoundaryTransformOptions,
): ClientBoundaryTransformResult {
  const fileName = options.fileName ?? "route.tsx";
  const hydrate = options.hydrate ?? "visible";
  const boundaryImport = options.boundaryImport ?? DEFAULT_BOUNDARY_IMPORT;
  const ordinalOffset = options.ordinalOffset ?? 0;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const collected = collectClientImports(sourceFile, boundaryImport);

  if (collected.importsByLocalName.size === 0 && collected.namespaceImports.size === 0) {
    return { code: source, transformed: false, boundaries: [], diagnostics: [] };
  }

  const boundaries: ClientBoundaryRecord[] = [];
  const diagnostics: ClientBoundaryDiagnostic[] = [];

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visitor: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node) && collected.removableImports.has(node)) {
        return undefined;
      }

      if (ts.isJsxSelfClosingElement(node)) {
        const binding = resolveClientBinding(node.tagName, collected);
        if (binding) {
          pushInvalidHostContextDiagnostic({
            element: node,
            binding,
            routeId: options.routeId,
            sourceFile,
            fileName,
            diagnostics,
          });
          return createBoundaryElement({
            element: node,
            attributes: node.attributes,
            binding,
            routeId: options.routeId,
            hydrate,
            ordinalOffset,
            boundaryReplay: options.boundaryReplay,
            fileName,
            sourceFile,
            boundaries,
            diagnostics,
          });
        }
      }

      if (ts.isJsxElement(node)) {
        const binding = resolveClientBinding(node.openingElement.tagName, collected);
        if (binding) {
          pushInvalidHostContextDiagnostic({
            element: node.openingElement,
            binding,
            routeId: options.routeId,
            sourceFile,
            fileName,
            diagnostics,
          });
          const meaningfulChildren = node.children.filter(isMeaningfulJsxChild);
          if (meaningfulChildren.length > 0) {
            diagnostics.push(createDiagnostic(
              "MANDU_BOUNDARY_UNSUPPORTED_CHILDREN",
              "Client boundary transform currently supports self-closing client components only. Move children into serializable props or use an explicit island API.",
              "Remove the children from this client component and pass plain serializable data as props, or keep this case on the explicit island API until server slots are supported.",
              options.routeId,
              undefined,
              binding.module,
              binding.exportName,
              sourceFile,
              fileName,
              node,
            ));
          }
          return createBoundaryElement({
            element: node.openingElement,
            attributes: node.openingElement.attributes,
            binding,
            routeId: options.routeId,
            hydrate,
            ordinalOffset,
            boundaryReplay: options.boundaryReplay,
            fileName,
            sourceFile,
            boundaries,
            diagnostics,
          });
        }
      }

      return ts.visitEachChild(node, visitor, context);
    };

    return (node) => ts.visitNode(node, visitor) as ts.SourceFile;
  };

  const result = ts.transform(sourceFile, [transformer]);
  const transformedSource = result.transformed[0] as ts.SourceFile;
  const withBoundaryImport =
    boundaries.length > 0 && !collected.hasBoundaryImport
      ? addBoundaryImport(transformedSource, boundaryImport)
      : transformedSource;
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const code = printer.printFile(withBoundaryImport);
  result.dispose();

  return {
    code,
    transformed: boundaries.length > 0,
    boundaries,
    diagnostics,
  };
}

function pushInvalidHostContextDiagnostic(args: {
  element: ts.Node;
  binding: ClientImportBinding;
  routeId: string;
  sourceFile: ts.SourceFile;
  fileName: string;
  diagnostics: ClientBoundaryDiagnostic[];
}): void {
  const invalidContext = findInvalidBoundaryHostContext(args.element);
  if (!invalidContext) return;

  args.diagnostics.push(createDiagnostic(
    "MANDU_BOUNDARY_INVALID_HOST_CONTEXT",
    `Client boundary transform cannot emit its placeholder inside <${invalidContext.tagName}> because the SSR marker uses sibling <div> and <script> nodes.`,
    `Move this client component outside <${invalidContext.tagName}>, wrap the valid HTML section in a server component, or use an explicit island API until context-safe markers are supported.`,
    args.routeId,
    undefined,
    args.binding.module,
    args.binding.exportName,
    args.sourceFile,
    args.fileName,
    invalidContext.node,
  ));
}

function findInvalidBoundaryHostContext(element: ts.Node): { tagName: string; node: ts.Node } | null {
  let current: ts.Node | undefined = element.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const tagName = getIntrinsicJsxTagName(current.openingElement.tagName);
      if (tagName && INVALID_BOUNDARY_HOST_CONTEXTS.has(tagName)) {
        return { tagName, node: current.openingElement };
      }
    }
    current = current.parent;
  }
  return null;
}

function getIntrinsicJsxTagName(tagName: ts.JsxTagNameExpression): string | null {
  if (!ts.isIdentifier(tagName)) return null;
  const text = tagName.text;
  return text.length > 0 && text[0] === text[0].toLowerCase()
    ? text.toLowerCase()
    : null;
}

function collectClientImports(sourceFile: ts.SourceFile, boundaryImport: string): CollectedClientImports {
  const importsByLocalName = new Map<string, ClientImportBinding>();
  const namespaceImports = new Map<string, NamespaceImportBinding>();
  const removableImports = new Set<ts.ImportDeclaration>();
  let hasBoundaryImport = false;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = getStringModuleSpecifier(statement);
    if (!moduleSpecifier) continue;
    if (moduleSpecifier === boundaryImport) {
      hasBoundaryImport = true;
      continue;
    }
    if (!isClientModuleSpecifier(moduleSpecifier)) continue;

    const importClause = statement.importClause;
    if (!importClause || importClause.isTypeOnly) continue;

    let hasRuntimeBinding = false;
    if (importClause.name) {
      importsByLocalName.set(importClause.name.text, {
        module: moduleSpecifier,
        exportName: "default",
        localName: importClause.name.text,
      });
      hasRuntimeBinding = true;
    }

    const namedBindings = importClause.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if (element.isTypeOnly) continue;
        const importedName = element.propertyName?.text ?? element.name.text;
        importsByLocalName.set(element.name.text, {
          module: moduleSpecifier,
          exportName: importedName,
          localName: element.name.text,
        });
        hasRuntimeBinding = true;
      }
    }

    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      namespaceImports.set(namedBindings.name.text, {
        module: moduleSpecifier,
        namespace: namedBindings.name.text,
      });
      hasRuntimeBinding = true;
    }

    if (hasRuntimeBinding) {
      removableImports.add(statement);
    }
  }

  return {
    importsByLocalName,
    namespaceImports,
    removableImports,
    hasBoundaryImport,
  };
}

function resolveClientBinding(
  tagName: ts.JsxTagNameExpression,
  collected: CollectedClientImports,
): ClientImportBinding | null {
  if (ts.isIdentifier(tagName)) {
    return collected.importsByLocalName.get(tagName.text) ?? null;
  }

  if (
    ts.isPropertyAccessExpression(tagName) &&
    ts.isIdentifier(tagName.expression)
  ) {
    const namespace = collected.namespaceImports.get(tagName.expression.text);
    if (!namespace) return null;
    const localName = `${namespace.namespace}.${tagName.name.text}`;
    return {
      module: namespace.module,
      exportName: tagName.name.text,
      localName,
    };
  }

  return null;
}

function createBoundaryElement(args: {
  element: ts.Node;
  attributes: ts.JsxAttributes;
  binding: ClientImportBinding;
  routeId: string;
  hydrate: ClientBoundaryHydrateMode;
  ordinalOffset: number;
  boundaryReplay?: readonly ClientBoundaryReplayRecord[];
  fileName: string;
  sourceFile: ts.SourceFile;
  boundaries: ClientBoundaryRecord[];
  diagnostics: ClientBoundaryDiagnostic[];
}): ts.JsxSelfClosingElement {
  const localOrdinal = args.boundaries.length;
  const replay = args.boundaryReplay?.[localOrdinal];
  const ordinal = replay?.ordinal ?? args.ordinalOffset + localOrdinal;
  const id = replay?.id ?? `${args.routeId}--${ordinal}`;
  const props = createPropsObject(
    args.attributes,
    args.sourceFile,
    args.fileName,
    args.element,
    args.routeId,
    id,
    args.binding,
    args.diagnostics,
  );
  const position = args.sourceFile.getLineAndCharacterOfPosition(args.element.getStart(args.sourceFile));

  args.boundaries.push({
    id,
    routeId: args.routeId,
    module: args.binding.module,
    importSpecifier: args.binding.module,
    exportName: args.binding.exportName,
    localName: args.binding.localName,
    hydrate: args.hydrate,
    ordinal,
    propsSource: "inline",
    propsKeys: collectStaticPropKeys(args.attributes),
    hasSpreadProps: args.attributes.properties.some(ts.isJsxSpreadAttribute),
    source: {
      file: args.fileName,
      line: position.line + 1,
      column: position.character + 1,
    },
  });

  return ts.factory.createJsxSelfClosingElement(
    ts.factory.createIdentifier(BOUNDARY_COMPONENT),
    undefined,
    ts.factory.createJsxAttributes([
      createStringJsxAttribute("routeId", args.routeId),
      createStringJsxAttribute("boundaryId", id),
      createStringJsxAttribute("module", args.binding.module),
      createStringJsxAttribute("exportName", args.binding.exportName),
      createStringJsxAttribute("hydrate", args.hydrate),
      ts.factory.createJsxAttribute(
        ts.factory.createIdentifier("props"),
        ts.factory.createJsxExpression(undefined, props),
      ),
    ]),
  );
}

function createPropsObject(
  attributes: ts.JsxAttributes,
  sourceFile: ts.SourceFile,
  fileName: string,
  element: ts.Node,
  routeId: string,
  boundaryId: string,
  binding: ClientImportBinding,
  diagnostics: ClientBoundaryDiagnostic[],
): ts.ObjectLiteralExpression {
  const props: ts.ObjectLiteralElementLike[] = [];

  for (const prop of attributes.properties) {
    if (ts.isJsxSpreadAttribute(prop)) {
      props.push(ts.factory.createSpreadAssignment(prop.expression));
      continue;
    }

    const name = getJsxAttributeName(prop.name, sourceFile);
    if (name === "key") continue;
    if (name === "ref") {
      diagnostics.push(createDiagnostic(
        "MANDU_BOUNDARY_UNSUPPORTED_REF",
        "Client boundary transform cannot serialize React refs across the server/client boundary.",
        "Remove the ref from the server-rendered client boundary. If the client component needs a ref, create it inside the client component.",
        routeId,
        boundaryId,
        binding.module,
        binding.exportName,
        sourceFile,
        fileName,
        element,
      ));
      continue;
    }

    const value = jsxAttributeInitializerToExpression(prop.initializer);
    if (isUnsupportedFunctionPropValue(value)) {
      diagnostics.push(createDiagnostic(
        "MANDU_BOUNDARY_UNSUPPORTED_FUNCTION_PROP",
        `Client boundary transform cannot serialize function prop "${name}" across the server/client boundary.`,
        `Move "${name}" into the client component, call a server/API action from the client, or pass a serializable action identifier instead.`,
        routeId,
        boundaryId,
        binding.module,
        binding.exportName,
        sourceFile,
        fileName,
        prop,
      ));
      continue;
    }

    const unsupportedValue = findUnsupportedStaticPropValue(value, sourceFile);
    if (unsupportedValue) {
      diagnostics.push(createDiagnostic(
        "MANDU_BOUNDARY_UNSUPPORTED_PROP_VALUE",
        `Client boundary transform cannot serialize prop "${name}" because ${unsupportedValue.reason}.`,
        `Replace "${name}" with plain serializable data, or construct the non-serializable value inside the client component.`,
        routeId,
        boundaryId,
        binding.module,
        binding.exportName,
        sourceFile,
        fileName,
        unsupportedValue.node,
      ));
      continue;
    }

    props.push(ts.factory.createPropertyAssignment(
      createPropertyName(name),
      value,
    ));
  }

  return ts.factory.createObjectLiteralExpression(props, true);
}

function isUnsupportedFunctionPropValue(value: ts.Expression): boolean {
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value);
}

function findUnsupportedStaticPropValue(
  value: ts.Expression,
  sourceFile: ts.SourceFile,
): { node: ts.Node; reason: string } | null {
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return { node: value, reason: "functions are not serializable" };
  }

  if (ts.isClassExpression(value)) {
    return { node: value, reason: "class instances and constructors are not serializable boundary props" };
  }

  if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value)) {
    return { node: value, reason: "React elements cannot be serialized as client boundary props" };
  }

  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "Symbol") {
    return { node: value, reason: "symbols are not supported as client boundary props" };
  }

  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isMethodDeclaration(property) || ts.isGetAccessor(property) || ts.isSetAccessor(property)) {
        return { node: property, reason: "object methods and accessors are not serializable" };
      }
      if (ts.isPropertyAssignment(property)) {
        const nested = findUnsupportedStaticPropValue(property.initializer, sourceFile);
        if (nested) return nested;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        continue;
      }
    }
    return null;
  }

  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) continue;
      const nested = findUnsupportedStaticPropValue(element, sourceFile);
      if (nested) return nested;
    }
    return null;
  }

  if (ts.isNewExpression(value)) {
    const expressionText = value.expression.getText(sourceFile);
    if (expressionText === "Date" || expressionText === "URL" || expressionText === "RegExp" || expressionText === "Map" || expressionText === "Set" || expressionText === "Error") {
      return null;
    }
    return { node: value, reason: `new ${expressionText}(...) creates a non-plain object` };
  }

  return null;
}

function collectStaticPropKeys(attributes: ts.JsxAttributes): string[] {
  const keys: string[] = [];
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop)) continue;
    const name = getJsxAttributeName(prop.name, prop.getSourceFile());
    if (name === "key" || name === "ref") continue;
    keys.push(name);
  }
  return keys;
}

function jsxAttributeInitializerToExpression(
  initializer: ts.JsxAttribute["initializer"],
): ts.Expression {
  if (!initializer) return ts.factory.createTrue();
  if (ts.isStringLiteral(initializer)) return ts.factory.createStringLiteral(initializer.text);
  if (ts.isJsxExpression(initializer)) {
    return initializer.expression ?? ts.factory.createTrue();
  }
  return initializer as unknown as ts.Expression;
}

function addBoundaryImport(sourceFile: ts.SourceFile, boundaryImport: string): ts.SourceFile {
  const boundaryImportDeclaration = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(
          false,
          undefined,
          ts.factory.createIdentifier(BOUNDARY_COMPONENT),
        ),
      ]),
    ),
    ts.factory.createStringLiteral(boundaryImport),
  );
  const statements = [...sourceFile.statements];
  const insertAt = findImportInsertionIndex(statements);
  statements.splice(insertAt, 0, boundaryImportDeclaration);
  return ts.factory.updateSourceFile(sourceFile, statements);
}

function findImportInsertionIndex(statements: readonly ts.Statement[]): number {
  let index = 0;
  while (index < statements.length && isUseDirective(statements[index])) {
    index++;
  }
  return index;
}

function isUseDirective(statement: ts.Statement | undefined): boolean {
  return !!statement &&
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression);
}

function isMeaningfulJsxChild(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) return child.getText().trim().length > 0;
  if (ts.isJsxExpression(child)) return !!child.expression;
  return true;
}

function createStringJsxAttribute(name: string, value: string): ts.JsxAttribute {
  return ts.factory.createJsxAttribute(
    ts.factory.createIdentifier(name),
    ts.factory.createStringLiteral(value),
  );
}

function createPropertyName(name: string): ts.PropertyName {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? ts.factory.createIdentifier(name)
    : ts.factory.createStringLiteral(name);
}

function getJsxAttributeName(name: ts.JsxAttributeName, sourceFile: ts.SourceFile): string {
  return ts.isIdentifier(name) ? name.text : name.getText(sourceFile);
}

function createDiagnostic(
  code: ClientBoundaryDiagnostic["code"],
  message: string,
  suggestion: string,
  routeId: string,
  boundaryId: string | undefined,
  module: string | undefined,
  exportName: string | undefined,
  sourceFile: ts.SourceFile,
  fileName: string,
  node: ts.Node,
): ClientBoundaryDiagnostic {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    code,
    severity: "error",
    message,
    suggestion,
    routeId,
    boundaryId,
    module,
    exportName,
    source: {
      file: fileName,
      line: position.line + 1,
      column: position.character + 1,
    },
  };
}

export function formatClientBoundaryDiagnostic(diagnostic: ClientBoundaryDiagnostic): string {
  const context = [
    `route=${diagnostic.routeId}`,
    diagnostic.boundaryId ? `boundary=${diagnostic.boundaryId}` : undefined,
    diagnostic.module ? `module=${diagnostic.module}` : undefined,
    diagnostic.exportName ? `export=${diagnostic.exportName}` : undefined,
  ].filter(Boolean).join(" ");
  return `${diagnostic.code} ${diagnostic.source.file}:${diagnostic.source.line}:${diagnostic.source.column} ${context} ${diagnostic.message} Suggestion: ${diagnostic.suggestion}`;
}

export function formatClientBoundaryDiagnostics(diagnostics: readonly ClientBoundaryDiagnostic[]): string {
  return diagnostics.map(formatClientBoundaryDiagnostic).join("\n");
}

export function assertNoClientBoundaryDiagnostics(diagnostics: readonly ClientBoundaryDiagnostic[]): void {
  if (diagnostics.length === 0) return;
  throw new Error(`Mandu client boundary transform failed:\n${formatClientBoundaryDiagnostics(diagnostics)}`);
}

export function validateClientBoundaryExport(
  clientSource: string,
  boundary: Pick<ClientBoundaryRecord, "id" | "routeId" | "module" | "exportName" | "source">,
  fileName = boundary.module,
): { status: ClientBoundaryExportValidationStatus; diagnostic?: ClientBoundaryDiagnostic } {
  const sourceFile = ts.createSourceFile(
    fileName,
    clientSource,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".jsx") || fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const status = hasRuntimeExport(sourceFile, boundary.exportName);
  if (status !== "missing") return { status };

  return {
    status,
    diagnostic: {
      code: "MANDU_BOUNDARY_UNRESOLVED_EXPORT",
      severity: "error",
      message: `Client boundary module "${boundary.module}" does not export "${boundary.exportName}".`,
      suggestion: boundary.exportName === "default"
        ? "Add a default export to the client module, or import a named client export from the server route."
        : `Export "${boundary.exportName}" from the client module, or update the server route to import an existing client export.`,
      routeId: boundary.routeId,
      boundaryId: boundary.id,
      module: boundary.module,
      exportName: boundary.exportName,
      source: boundary.source,
    },
  };
}

export function validateClientBoundaryServerOnlyImports(
  clientSource: string,
  boundary: Pick<ClientBoundaryRecord, "id" | "routeId" | "module" | "exportName">,
  fileName = boundary.module,
): ClientBoundaryDiagnostic[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    clientSource,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".jsx") || fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics: ClientBoundaryDiagnostic[] = [];
  const seen = new Set<string>();

  const addDiagnostic = (specifier: string, node: ts.Node): void => {
    const normalized = normalizeServerOnlyModuleSpecifier(specifier);
    if (!normalized) return;
    const key = `${normalized}:${node.getStart(sourceFile)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    diagnostics.push({
      code: "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      severity: "error",
      message: `Client boundary module "${boundary.module}" imports server-only module "${specifier}".`,
      suggestion: `Move "${specifier}" usage into a server route, loader, API, or server wrapper, then pass plain serializable data into the client component.`,
      routeId: boundary.routeId,
      boundaryId: boundary.id,
      module: boundary.module,
      exportName: boundary.exportName,
      source: {
        file: fileName,
        line: position.line + 1,
        column: position.character + 1,
      },
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) return;
      const moduleSpecifier = getStringModuleSpecifier(node);
      if (moduleSpecifier) addDiagnostic(moduleSpecifier, node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) return;
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        addDiagnostic(moduleSpecifier.text, moduleSpecifier);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      addDiagnostic(node.moduleReference.expression.text, node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const specifier = firstStringArgument(node);
      if (specifier && isRequireOrDynamicImport(node.expression)) {
        addDiagnostic(specifier, node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}

function normalizeServerOnlyModuleSpecifier(specifier: string): string | null {
  const normalized = specifier.replace(/\\/g, "/");
  if (normalized === "server-only") return normalized;
  if (normalized === "bun" || normalized.startsWith("bun:")) return normalized;
  if (normalized.startsWith("node:")) return normalized;
  if (normalized === "@mandujs/core" || (normalized.startsWith("@mandujs/core/") && !normalized.startsWith("@mandujs/core/client"))) {
    return normalized;
  }
  if (/\.server(?:\.[cm]?[jt]sx?)?$/.test(normalized)) return normalized;

  const [head] = normalized.split("/");
  if (head && SERVER_ONLY_MODULE_SPECIFIERS.has(head)) return head;
  return null;
}

function firstStringArgument(node: ts.CallExpression): string | null {
  const first = node.arguments[0];
  return first && ts.isStringLiteral(first) ? first.text : null;
}

function isRequireOrDynamicImport(expression: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expression) && expression.text === "require") ||
    expression.kind === ts.SyntaxKind.ImportKeyword
  );
}

function hasRuntimeExport(sourceFile: ts.SourceFile, exportName: string): ClientBoundaryExportValidationStatus {
  let sawUnknownReExport = false;

  for (const statement of sourceFile.statements) {
    if (exportName === "default" && hasDefaultExport(statement)) {
      return "found";
    }

    if (exportName !== "default" && hasNamedRuntimeExport(statement, exportName)) {
      return "found";
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      sawUnknownReExport = true;
    }
  }

  return sawUnknownReExport ? "unknown" : "missing";
}

function hasDefaultExport(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) return true;
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
    hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
}

function hasNamedRuntimeExport(statement: ts.Statement, exportName: string): boolean {
  if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === exportName) {
      return true;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
          return true;
        }
      }
    }
  }

  if (ts.isExportDeclaration(statement)) {
    if (!statement.exportClause) return statement.moduleSpecifier ? false : "default" === exportName;
    if (!ts.isNamedExports(statement.exportClause)) return false;

    for (const element of statement.exportClause.elements) {
      const exportedName = element.name.text;
      if (exportedName === exportName) return !statement.moduleSpecifier;
    }
  }

  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind.ExportKeyword | ts.SyntaxKind.DefaultKeyword): boolean {
  return !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind);
}

function getStringModuleSpecifier(importDeclaration: ts.ImportDeclaration): string | null {
  return ts.isStringLiteral(importDeclaration.moduleSpecifier)
    ? importDeclaration.moduleSpecifier.text
    : null;
}

export function collectStaticImportSpecifiers(source: string, fileName = "module.tsx"): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue;
      const moduleSpecifier = getStringModuleSpecifier(statement);
      if (moduleSpecifier) specifiers.push(moduleSpecifier);
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const moduleSpecifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
      if (moduleSpecifier) specifiers.push(moduleSpecifier);
    }
  }

  return specifiers;
}

export function isClientBoundaryModuleSpecifier(specifier: string): boolean {
  return CLIENT_MODULE_PATTERN.test(specifier.replace(/\\/g, "/"));
}

function isClientModuleSpecifier(specifier: string): boolean {
  return isClientBoundaryModuleSpecifier(specifier);
}
