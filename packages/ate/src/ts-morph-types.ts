/**
 * Lightweight type interfaces for ts-morph (lazily imported).
 * These mirror the subset of ts-morph API used by ATE,
 * avoiding a hard compile-time dependency on ts-morph.
 */

/** Minimal ts-morph Node interface */
export interface Node {
  getKind(): number;
  getText(): string;
  getDescendantsOfKind(kind: number): Node[];
}

/** ts-morph JsxAttribute */
export interface JsxAttribute extends Node {
  getNameNode?(): { getText(): string };
  getName?(): string;
  getInitializer?(): (Node & { getLiteralValue?(): string }) | undefined;
}

/** ts-morph CallExpression */
export interface CallExpression extends Node {
  getExpression(): Node;
  getArguments(): (Node & { getLiteralValue?(): string })[];
}

/** ts-morph SourceFile */
export interface SourceFile extends Node {
  getFilePath(): string;
  getExportedDeclarations(): ReadonlyMap<string, Node[]>;
  getDescendantsOfKind(kind: number): Node[];
  getImportDeclarations(): ImportDeclaration[];
  getExportDeclarations(): ExportDeclaration[];
}

/** ts-morph ImportDeclaration */
export interface ImportDeclaration extends Node {
  getModuleSpecifierValue(): string;
}

/** ts-morph ExportDeclaration */
export interface ExportDeclaration extends Node {
  getModuleSpecifier(): (Node & { getLiteralText(): string }) | undefined;
}

/** ts-morph Project */
export interface Project {
  addSourceFileAtPath(filePath: string): SourceFile;
  addSourceFilesAtPaths(globs: string[]): SourceFile[];
  getSourceFile(filePath: string): SourceFile | undefined;
  getSourceFiles(): SourceFile[];
}

/** SyntaxKind enum-like object used via dynamic import */
export interface SyntaxKindEnum {
  StringLiteral: number;
  JsxAttribute: number;
  CallExpression: number;
  [key: string]: string | number;
}
